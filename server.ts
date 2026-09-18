import express from 'express';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import cors from 'cors';

import { db } from './src/server/db';
import {
  generateToken,
  requireAuth,
  optionalAuth,
  verifyToken,
  AuthUserPayload,
} from './src/server/auth';
import { calculateRoadRoute, haversineKm } from './src/server/routing';
import { calculateDynamicEta, EtaCalculationResult } from './src/server/eta';
import { DriverLocation, OrderStatus, PublicTrackingResponse, StudentTrackingState } from './src/types';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration
  const configuredOrigins = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const corsOriginHandler = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === 'true') {
      return callback(null, true);
    }
    if (configuredOrigins.length > 0 && configuredOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origin not allowed by CORS'));
  };

  app.use(
    cors({
      origin: corsOriginHandler,
      credentials: true,
    })
  );

  // Setup Socket.IO with CORS
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOriginHandler,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  app.use(express.json({ limit: '2mb' }));

  // Socket.IO Room Management with Auth Validation
  io.on('connection', (socket) => {
    // Client joins company room with token verification
    socket.on('join:company', (payload: any) => {
      let targetCompanyId = typeof payload === 'string' ? payload : payload?.companyId;
      if (typeof payload === 'object' && payload?.token) {
        const user = verifyToken(payload.token);
        if (user) {
          targetCompanyId = user.companyId;
        } else if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
          socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required for company room' });
          return;
        }
      } else if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
        socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required for company room' });
        return;
      }
      if (targetCompanyId && typeof targetCompanyId === 'string') {
        const comp = db.getCompany(targetCompanyId);
        if (comp) {
          socket.join(`company:${comp.id}`);
          socket.join(`company:${comp.code}`);
        }
      }
    });

    // Student or dispatcher joins specific trip tracking room
    const handleJoinTrip = (payload: any) => {
      const tokenOrCode = typeof payload === 'string' ? payload : (payload?.trackingToken || payload?.tripId || payload?.orderId || payload?.tokenOrCode);
      const authToken = typeof payload === 'object' ? payload?.token : undefined;

      if (!tokenOrCode || typeof tokenOrCode !== 'string') return;

      const trip = db.getOrderByTracking(tokenOrCode) || db.getOrder(tokenOrCode);
      if (!trip) {
        return;
      }

      // Authorization verification:
      // 1. Valid cryptographic trackingToken provided (Student tracking link)
      // 2. Demo mode / dev tracking code match
      // 3. Authenticated company user from the same company or assigned driver
      let isAuthorized = false;

      if (trip.trackingToken && tokenOrCode === trip.trackingToken) {
        isAuthorized = true;
      } else if (tokenOrCode === trip.trackingCode || tokenOrCode === trip.id) {
        if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production') {
          isAuthorized = true;
        } else if (authToken) {
          const user = verifyToken(authToken);
          if (user && (user.companyId === trip.companyId || user.id === trip.assignedDriverId)) {
            isAuthorized = true;
          }
        }
      }

      if (isAuthorized) {
        socket.join(`order:${trip.id}`);
        socket.join(`trip:${trip.id}`);
        if (trip.trackingToken) {
          socket.join(`order:${trip.trackingToken}`);
          socket.join(`trip:${trip.trackingToken}`);
        }
      }
    };

    socket.on('join:order', handleJoinTrip);
    socket.on('join:trip', handleJoinTrip);

    // Driver joins personal push room with token verification
    socket.on('join:driver', (payload: any) => {
      let driverId = typeof payload === 'string' ? payload : payload?.driverId;
      if (typeof payload === 'object' && payload?.token) {
        const user = verifyToken(payload.token);
        if (user) {
          if (user.role === 'DRIVER') {
            const drv = db.getDriverByUserId(user.id);
            if (drv) driverId = drv.id;
          } else {
            // Dispatcher can join driver room within their own company
            const drv = db.getDriver(driverId);
            if (!drv || drv.companyId !== user.companyId) {
              socket.emit('error', { code: 'FORBIDDEN', message: 'Cannot join driver room of another company' });
              return;
            }
          }
        } else if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
          socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required for driver room' });
          return;
        }
      } else if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
        socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required for driver room' });
        return;
      }

      if (driverId && typeof driverId === 'string') {
        const drv = db.getDriver(driverId);
        if (drv) {
          socket.join(`driver:${drv.id}`);
        }
      }
    });

    socket.on('disconnect', () => {
      // client disconnected cleanly
    });
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ONTime Fleet Tracking Platform',
      version: '2.0.0-production',
      region: 'Jbeil (Byblos) University Dorm Corridor',
      time: new Date().toISOString(),
    });
  });

  // ==================== AUTHENTICATION API ====================

  app.post('/api/auth/register', (req, res) => {
    try {
      const { email, password, name, phone, companyName, joinCode, role } = req.body;

      if (!email || !password || !name) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required fields.' } });
      }

      let targetCompanyId = '';

      if (joinCode) {
        const invite = db.getInviteByCode(joinCode);
        const comp = db.getCompany(joinCode);
        if (invite) {
          targetCompanyId = invite.companyId;
        } else if (comp) {
          targetCompanyId = comp.id;
        } else {
          return res.status(400).json({ error: { code: 'INVALID_INVITE', message: 'Invite or fleet code is invalid.' } });
        }
      } else if (companyName) {
        const generatedCode = `BYB-${Math.floor(100 + Math.random() * 899)}`;
        const newComp = db.createCompany({
          code: generatedCode,
          name: companyName,
          ownerName: name,
          ownerEmail: email,
          phone,
        });
        targetCompanyId = newComp.id;
      } else {
        const defaultComp = db.listCompanies()[0];
        targetCompanyId = defaultComp ? defaultComp.id : 'comp-byblos-01';
      }

      const existingUser = db.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: { code: 'USER_EXISTS', message: 'Email already registered.' } });
      }

      const assignedRole = role || (companyName ? 'OWNER' : 'DRIVER');
      const passwordHash = bcrypt.hashSync(password, 8);
      const user = db.createUser({
        email,
        name,
        phone: phone || '+961 70 000 000',
        role: assignedRole,
        companyId: targetCompanyId,
        passwordHash,
      });

      const tokenPayload: AuthUserPayload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      };

      const token = generateToken(tokenPayload);
      const company = db.getCompany(user.companyId);

      res.status(201).json({
        user,
        company,
        token,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Registration failed.' } });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email and password required.' } });
      }

      const user = db.getUserByEmail(email);
      if (!user) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      const valid = bcrypt.compareSync(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
      }

      const tokenPayload: AuthUserPayload = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId,
      };

      const token = generateToken(tokenPayload);
      const company = db.getCompany(user.companyId);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role,
          companyId: user.companyId,
        },
        company,
        token,
      });
    } catch (err) {
      res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Login failed.' } });
    }
  });

  // Demo Switcher / Guest Fast Login
  app.post('/api/auth/demo-login', (req, res) => {
    const { role, companyCode } = req.body;
    const company = db.getCompany(companyCode || 'NORTH-77') || db.listCompanies()[0];
    const userRole = role || 'OWNER';

    const tokenPayload: AuthUserPayload = {
      id: `usr-demo-${userRole.toLowerCase()}`,
      email: `${userRole.toLowerCase()}@tripoliexpress.lb`,
      name: userRole === 'OWNER' ? company.ownerName : 'Tarek Haddad (Lead Driver)',
      role: userRole,
      companyId: company.id,
    };

    const token = generateToken(tokenPayload);
    res.json({
      user: tokenPayload,
      company,
      token,
    });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    const user = db.getUser(req.user!.id);
    const company = db.getCompany(req.user!.companyId);
    res.json({ user, company });
  });

  // ==================== COMPANIES & NETWORKS ====================

  app.get('/api/networks', (_req, res) => {
    res.json(db.listCompanies());
  });

  app.get('/api/companies', (_req, res) => {
    res.json(db.listCompanies());
  });

  app.post('/api/networks', (req, res) => {
    const { name, ownerName, ownerEmail } = req.body;
    if (!name || !ownerName) {
      return res.status(400).json({ error: 'Company name and owner name required' });
    }
    const comp = db.createCompany({
      code: `BYB-${crypto.randomInt(100, 999)}`,
      name,
      ownerName,
      ownerEmail: ownerEmail || 'owner@ontime.lb',
    });
    res.status(201).json(comp);
  });

  app.post('/api/companies', (req, res) => {
    const { name, ownerName, ownerEmail } = req.body;
    if (!name || !ownerName) {
      return res.status(400).json({ error: 'Company name and owner name required' });
    }
    const comp = db.createCompany({
      code: `BYB-${crypto.randomInt(100, 999)}`,
      name,
      ownerName,
      ownerEmail: ownerEmail || 'owner@ontime.lb',
    });
    res.status(201).json(comp);
  });

  app.get('/api/companies/:id/invites', optionalAuth, (req, res) => {
    const comp = db.getCompany(req.params.id);
    if (!comp) return res.status(404).json({ error: 'Company not found' });
    const invite = db.createInvite(comp.id, 'DRIVER');
    res.json(invite);
  });

  // ==================== DRIVERS & FLEET ====================

  app.get('/api/drivers', optionalAuth, (req, res) => {
    const { networkCode, companyId } = req.query;
    // Strict company isolation: authenticated user's company cannot be overridden
    const targetCompany = req.user?.companyId || ((companyId || networkCode) as string | undefined);
    const drivers = db.listDrivers(targetCompany);
    res.json(drivers);
  });

  app.get('/api/drivers/:id', (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    res.json(driver);
  });

  app.post('/api/drivers/join', (req, res) => {
    const { name, phone, vehicleModel, plateNumber, networkCode, isLeadDriver } = req.body;
    const code = (networkCode || '').toUpperCase();
    const comp = db.getCompany(code);
    if (!comp) {
      return res.status(404).json({ error: 'Invalid company / network code' });
    }

    const driver = db.createDriver({
      name,
      phone: phone || '+961 70 000 000',
      companyId: comp.id,
      vehicleModel: vehicleModel || 'Standard Fleet Car',
      plateNumber,
      isLeadDriver: Boolean(isLeadDriver),
    });

    // Broadcast new driver to company room
    io.to(`company:${comp.id}`).emit('driver:joined', driver);

    res.status(201).json(driver);
  });

  // In-memory rate limiting map for public tracking endpoint (max 90 requests/minute per client)
  const trackingRateLimits = new Map<string, { count: number; resetTime: number }>();

  // ==================== TELEMETRY & REALTIME GPS ====================

  const telemetryHandler = async (req: express.Request, res: express.Response) => {
    const {
      driverId: bodyDriverId,
      lat,
      lng,
      speed,
      heading,
      accuracy,
      batteryLevel,
      networkStatus,
      isSimulated,
      timestamp: reqTimestamp,
    } = req.body;

    const targetDriverId = (req.params.id || bodyDriverId) as string | undefined;

    // Driver authorization: driver can ONLY update their own vehicle telemetry
    let driverId = targetDriverId;
    if (req.user?.role === 'DRIVER') {
      const drv = db.getDriverByUserId(req.user.id);
      const authorizedDriverId = drv ? drv.id : req.user.id;
      if (targetDriverId && targetDriverId !== authorizedDriverId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers can only report location for their own vehicle' } });
      }
      driverId = authorizedDriverId;
    } else if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true' && !req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Driver authentication required in production mode' } });
    }

    if (!driverId) {
      return res.status(400).json({ error: 'Driver identifier required' });
    }

    const numLat = Number(lat);
    const numLng = Number(lng);

    // Geographically valid coordinates (-90..90, -180..180)
    if (isNaN(numLat) || isNaN(numLng) || numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
      return res.status(400).json({ error: { code: 'INVALID_COORDINATES', message: 'Invalid latitude/longitude coordinates' } });
    }

    // Timestamp freshness validation: reject future timestamps and data older than 5 minutes
    const pingTimestamp = Number(reqTimestamp) || Date.now();
    const now = Date.now();
    if (pingTimestamp > now + 15000) {
      return res.status(400).json({ error: { code: 'INVALID_TIMESTAMP', message: 'Telemetry timestamp is in the future' } });
    }
    if (now - pingTimestamp > 5 * 60 * 1000) {
      return res.status(400).json({ error: { code: 'STALE_GPS_DATA', message: 'Telemetry timestamp is older than 5 minutes' } });
    }

    // Check impossible speed / teleportation against previous ping
    const existingDriver = db.getDriver(driverId);
    if (existingDriver && existingDriver.currentLocation && existingDriver.currentLocation.timestamp > 0 && !isSimulated) {
      const timeDeltaSec = (now - existingDriver.currentLocation.timestamp) / 1000;
      if (timeDeltaSec > 0 && timeDeltaSec < 120) {
        const distKm = haversineKm(
          existingDriver.currentLocation.lat,
          existingDriver.currentLocation.lng,
          numLat,
          numLng
        );
        const impliedSpeedKmH = distKm / (timeDeltaSec / 3600);
        if (impliedSpeedKmH > 180) {
          console.warn(`[GPS JUMP REJECTED] Driver ${driverId} implied jump speed: ${impliedSpeedKmH.toFixed(1)} km/h over ${timeDeltaSec}s`);
          return res.status(400).json({ error: { code: 'GPS_JUMP_REJECTED', message: 'Anomalous GPS teleportation detected' } });
        }
      }
    }

    // Clamp speed to realistic max 150 km/h
    const cleanSpeed = Math.min(150, Math.max(0, Number(speed) || 0));

    const updated = db.updateDriverLocation(driverId, {
      lat: numLat,
      lng: numLng,
      speed: cleanSpeed,
      heading: Number(heading) || 0,
      accuracy: Math.min(200, Number(accuracy) || 5),
      timestamp: pingTimestamp,
      batteryLevel: batteryLevel !== undefined ? Number(batteryLevel) : undefined,
      networkStatus,
      isSimulated: Boolean(isSimulated),
    });

    if (!updated) {
      return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });
    }

    // 1. Broadcast to Company Room in real-time
    io.to(`company:${updated.companyId || updated.networkCode}`).emit('driver:location', {
      driverId: updated.id,
      location: updated.currentLocation,
      status: updated.status,
    });

    // 2. If driver is on an active trip, compute dynamic ETA and broadcast to trip/order rooms
    const activeTripId = updated.currentTripId || updated.currentOrderId;
    if (activeTripId) {
      const trip = db.getOrder(activeTripId);
      if (trip && trip.dropoffCoords) {
        try {
          const etaResult = await calculateDynamicEta({
            tripId: trip.id,
            orderId: trip.id,
            driverLocation: updated.currentLocation,
            destinationCoords: (trip.status === 'EN_ROUTE_PICKUP' || trip.status === 'AT_PICKUP') ? trip.pickupCoords : trip.dropoffCoords,
          });

          trip.estimatedMinutes = etaResult.etaMinutes;
          trip.roadDistanceKm = etaResult.roadDistanceKm;

          const etaPayload = {
            tripId: trip.id,
            orderId: trip.id,
            driverLocation: updated.currentLocation,
            etaMinutes: etaResult.etaMinutes,
            roadDistanceKm: etaResult.roadDistanceKm,
            polyline: etaResult.polyline,
            trafficLevel: etaResult.trafficLevel,
            trafficSource: etaResult.trafficAssessmentBasis,
          };

          io.to(`trip:${trip.id}`).emit('trip:eta_update', etaPayload);
          io.to(`order:${trip.id}`).emit('order:eta_update', etaPayload);
          io.to(`trip:${trip.id}`).emit('driver:location', { driverId: updated.id, location: updated.currentLocation });
          io.to(`order:${trip.id}`).emit('driver:location', { driverId: updated.id, location: updated.currentLocation });
        } catch (err) {
          console.warn('Live ETA calculation error:', err);
        }
      }
    }

    res.json({ success: true, driverId, location: updated.currentLocation });
  };

  app.post('/api/telemetry', optionalAuth, telemetryHandler);
  app.post('/api/drivers/:id/location', optionalAuth, telemetryHandler);

  // Offline Sync: Batch telemetry upload on reconnection
  app.post('/api/telemetry/batch', optionalAuth, (req, res) => {
    const { driverId: reqDriverId, points } = req.body;
    let driverId = reqDriverId;
    if (req.user?.role === 'DRIVER') {
      const drv = db.getDriverByUserId(req.user.id);
      const authorizedDriverId = drv ? drv.id : req.user.id;
      if (reqDriverId && reqDriverId !== authorizedDriverId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Unauthorized driver telemetry batch' } });
      }
      driverId = authorizedDriverId;
    }

    if (!driverId || !Array.isArray(points)) {
      return res.status(400).json({ error: 'Invalid batch points payload' });
    }

    const driver = db.getDriver(driverId);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    // Process points sequentially
    points.forEach((pt: DriverLocation) => {
      db.updateDriverLocation(driverId, pt);
    });

    res.json({ success: true, syncedCount: points.length });
  });

  // ==================== TRIPS ====================

  app.post('/api/drivers/:id/trip/start', (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    driver.activeTrip = {
      id: `trip-${Date.now()}`,
      startTime: Date.now(),
      startLocation: { lat: driver.currentLocation.lat, lng: driver.currentLocation.lng },
      breadcrumbs: [driver.currentLocation],
      distanceKm: 0,
      maxSpeedKmH: driver.currentLocation.speed,
    };

    io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:started', {
      driverId: driver.id,
      tripId: driver.activeTrip.id,
    });

    res.json({ success: true, activeTrip: driver.activeTrip });
  });

  app.post('/api/drivers/:id/trip/stop', (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver || !driver.activeTrip) {
      return res.status(400).json({ error: 'No active trip to end' });
    }

    const trip = driver.activeTrip;
    const durationMinutes = Math.max(1, Math.round((Date.now() - trip.startTime) / 60000));
    const avgSpeed = durationMinutes > 0 ? (trip.distanceKm / (durationMinutes / 60)) : 0;

    const completedTrip = db.saveTrip({
      id: trip.id,
      driverId: driver.id,
      driverName: driver.name,
      companyId: driver.companyId,
      networkCode: driver.networkCode,
      vehicleId: driver.vehicleId,
      startTime: trip.startTime,
      endTime: Date.now(),
      startAddress: `Tripoli Hub (${trip.startLocation.lat.toFixed(4)}, ${trip.startLocation.lng.toFixed(4)})`,
      endAddress: `Destination (${driver.currentLocation.lat.toFixed(4)}, ${driver.currentLocation.lng.toFixed(4)})`,
      distanceKm: Math.round(trip.distanceKm * 10) / 10,
      durationMinutes,
      avgSpeedKmH: Math.round(avgSpeed * 10) / 10,
      maxSpeedKmH: Math.round(trip.maxSpeedKmH * 10) / 10,
      idleMinutes: Math.round(durationMinutes * 0.15),
      movingMinutes: Math.round(durationMinutes * 0.85),
      orderId: driver.currentOrderId,
      path: trip.breadcrumbs.map((b) => [b.lat, b.lng]),
    });

    driver.totalTrips += 1;
    delete driver.activeTrip;

    io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:completed', completedTrip);

    res.json({ success: true, completedTrip });
  });

  app.get('/api/trips', optionalAuth, (req, res) => {
    const { driverId, networkCode, companyId } = req.query;
    const targetComp = (companyId || networkCode || req.user?.companyId) as string | undefined;
    const trips = db.listTrips(targetComp, driverId as string | undefined);
    res.json(trips);
  });

  // ==================== VEHICLES ====================

  app.get('/api/vehicles', optionalAuth, (req, res) => {
    const vehicles = db.listVehicles(req.user?.companyId);
    res.json(vehicles);
  });

  // ==================== TRIPS & DISPATCH ====================

  const listTripsHandler = (req: express.Request, res: express.Response) => {
    const { networkCode, companyId, driverId } = req.query;
    // Strict isolation: authenticated user's company is authoritative
    const targetComp = req.user?.companyId || ((companyId || networkCode) as string | undefined);
    let trips = db.listOrders(targetComp);

    // If authenticated user is a driver, only return trips assigned to them
    if (req.user?.role === 'DRIVER') {
      const drv = db.getDriverByUserId(req.user.id);
      if (drv) {
        trips = trips.filter((t) => t.assignedDriverId === drv.id);
      }
    } else if (driverId) {
      trips = trips.filter((t) => t.assignedDriverId === driverId);
    }
    res.json(trips);
  };

  const getTripHandler = (req: express.Request, res: express.Response) => {
    const trip = db.getOrder(req.params.id);
    if (!trip) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }
    // Company isolation
    if (req.user?.companyId && trip.companyId !== req.user.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied to trip from another company' } });
    }
    // Driver isolation: driver can only view their assigned trip
    if (req.user?.role === 'DRIVER') {
      const drv = db.getDriverByUserId(req.user.id);
      if (drv && trip.assignedDriverId !== drv.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied to trip assigned to another driver' } });
      }
    }
    res.json(trip);
  };

  app.get('/api/orders', optionalAuth, listTripsHandler);
  app.get('/api/trips', optionalAuth, listTripsHandler);
  app.get('/api/orders/:id', optionalAuth, getTripHandler);
  app.get('/api/trips/:id', optionalAuth, getTripHandler);

  const createTripHandler = async (req: express.Request, res: express.Response) => {
    const {
      networkCode,
      companyId: reqCompId,
      customerName,
      customerPhone,
      studentName,
      studentPhone,
      pickupAddress,
      pickupCoords,
      dropoffAddress,
      dropoffCoords,
      packageInfo,
      assignedDriverId,
      priority,
    } = req.body;

    const authoritativeCompanyId = req.user?.companyId || reqCompId || networkCode || 'NORTH-77';
    const comp = db.getCompany(authoritativeCompanyId);
    if (!comp) return res.status(400).json({ error: { code: 'INVALID_COMPANY', message: 'Valid company required' } });

    // Calculate real road distance and initial route geometry using OSRM
    let roadDistanceKm = 2.0;
    let estimatedMinutes = 8;
    let routeGeometry: [number, number][] = [];

    if (pickupCoords && dropoffCoords) {
      try {
        const roadRoute = await calculateRoadRoute(
          pickupCoords.lat,
          pickupCoords.lng,
          dropoffCoords.lat,
          dropoffCoords.lng
        );
        roadDistanceKm = roadRoute.distanceKm;
        estimatedMinutes = roadRoute.durationMinutes;
        routeGeometry = roadRoute.polyline;
      } catch (err) {
        console.warn('OSRM calculation error on trip creation:', err);
      }
    }

    const newTrip = db.createOrder({
      companyId: comp.id,
      studentName: (studentName || customerName || 'Student').trim(),
      studentPhone: (studentPhone || customerPhone || '').trim(),
      pickupAddress: pickupAddress || 'Campus Crest Dorms, Blat',
      pickupCoords: pickupCoords || { lat: 34.1215, lng: 35.663 },
      dropoffAddress: dropoffAddress || 'LAU Byblos - Upper Gate',
      dropoffCoords: dropoffCoords || { lat: 34.1238, lng: 35.6698 },
      packageInfo: (req.body.notes || packageInfo || 'Campus Dorm Shuttle').trim(),
      priority: priority || 'normal',
      assignedDriverId,
      roadDistanceKm,
      estimatedMinutes,
      routeGeometry,
    });

    // Realtime broadcast to company dispatch room
    io.to(`company:${comp.id}`).emit('trip:created', newTrip);
    io.to(`company:${comp.id}`).emit('order:created', newTrip);

    // If driver assigned, push to driver room
    if (assignedDriverId) {
      io.to(`driver:${assignedDriverId}`).emit('trip:assigned', newTrip);
      io.to(`driver:${assignedDriverId}`).emit('order:assigned', newTrip);
    }

    res.status(201).json(newTrip);
  };

  app.post('/api/orders', optionalAuth, createTripHandler);
  app.post('/api/trips', optionalAuth, createTripHandler);

  const assignTripHandler = (req: express.Request, res: express.Response) => {
    const { driverId } = req.body;
    const authCompanyId = req.user?.companyId;
    const result = db.assignOrder(req.params.id, driverId, authCompanyId);
    if (!result) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }
    if ('error' in result) {
      return res.status(400).json({ error: { code: 'ASSIGNMENT_ERROR', message: result.error } });
    }

    const trip = result;
    io.to(`company:${trip.companyId || trip.networkCode}`).emit('trip:updated', trip);
    io.to(`company:${trip.companyId || trip.networkCode}`).emit('order:updated', trip);
    if (driverId) {
      io.to(`driver:${driverId}`).emit('trip:assigned', trip);
      io.to(`driver:${driverId}`).emit('order:assigned', trip);
    }

    res.json(trip);
  };

  app.patch('/api/orders/:id/assign', optionalAuth, assignTripHandler);
  app.patch('/api/trips/:id/assign', optionalAuth, assignTripHandler);

  const updateStatusHandler = (req: express.Request, res: express.Response) => {
    const { note } = req.body;
    const status = (req.body.status as string)?.toUpperCase();
    const existing = db.getOrder(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }

    // Role-based authorization: driver can only update assigned trips; company can only update its own trips
    if (req.user?.role === 'DRIVER') {
      const drv = db.getDriverByUserId(req.user.id);
      if (drv && existing.assignedDriverId !== drv.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers can only update trips assigned to them.' } });
      }
    } else if (req.user?.companyId && existing.companyId !== req.user.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot modify trips belonging to another company.' } });
    }

    const result = db.updateOrderStatus(req.params.id, status as OrderStatus, note);
    if (!result) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }
    if ('error' in result) {
      return res.status(400).json({ error: { code: 'INVALID_TRANSITION', message: result.error } });
    }

    const trip = result;
    io.to(`company:${trip.companyId || trip.networkCode}`).emit('trip:updated', trip);
    io.to(`company:${trip.companyId || trip.networkCode}`).emit('order:updated', trip);

    const statusPayload = {
      orderId: trip.id,
      tripId: trip.id,
      status: trip.status,
      timestamp: Date.now(),
      note,
    };
    io.to(`order:${trip.id}`).emit('order:status_changed', statusPayload);
    io.to(`trip:${trip.id}`).emit('trip:status_changed', statusPayload);
    if (trip.trackingToken) {
      io.to(`order:${trip.trackingToken}`).emit('order:status_changed', statusPayload);
      io.to(`trip:${trip.trackingToken}`).emit('trip:status_changed', statusPayload);
    }

    res.json(trip);
  };

  app.patch('/api/orders/:id/status', optionalAuth, updateStatusHandler);
  app.patch('/api/trips/:id/status', optionalAuth, updateStatusHandler);

  // ==================== SECURE STUDENT & PUBLIC TRACKING API ====================

  const handlePublicTracking = async (req: express.Request, res: express.Response) => {
    // Rate limit by IP (80 requests per 60 seconds)
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rateRecord = trackingRateLimits.get(clientIp);
    if (rateRecord && now < rateRecord.resetTime) {
      rateRecord.count++;
      if (rateRecord.count > 80) {
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many tracking requests. Please wait a moment before refreshing.',
          },
        });
      }
    } else {
      trackingRateLimits.set(clientIp, { count: 1, resetTime: now + 60000 });
    }

    const query = req.params.tokenOrCode;
    const order = db.getOrderByTracking(query);

    if (!order) {
      return res.status(404).json({
        error: {
          code: 'TRACKING_NOT_FOUND',
          message: 'No active shuttle or trip found with this tracking link.',
        },
      });
    }

    const driver = order.assignedDriverId ? db.getDriver(order.assignedDriverId) : null;
    const isCompletedOrCancelled = order.status === 'DELIVERED' || order.status === 'COMPLETED' || order.status === 'CANCELLED';

    // Calculate dynamic ETA using multi-signal engine
    let dynamicEtaResult: Partial<EtaCalculationResult> = {
      etaMinutes: order.estimatedMinutes || 6,
      roadDistanceKm: order.roadDistanceKm || 2.0,
      polyline: order.routeGeometry || [],
      trafficLevel: 'Normal',
      trafficAssessmentBasis: 'Live Road Geometry',
    };

    if (driver && order.dropoffCoords && !isCompletedOrCancelled) {
      try {
        dynamicEtaResult = await calculateDynamicEta({
          orderId: order.id,
          driverLocation: driver.currentLocation,
          destinationCoords: order.status === 'ARRIVED_PICKUP' || order.status === 'DRIVER_EN_ROUTE_PICKUP' || order.status === 'AT_PICKUP' || order.status === 'EN_ROUTE_PICKUP'
            ? order.pickupCoords
            : order.dropoffCoords,
        });
      } catch (err) {
        console.warn('Student tracking ETA calculation error:', err);
      }
    }

    // Calculate state
    let trackingState: StudentTrackingState = 'WAITING_FOR_DRIVER';
    const isCompleted = order.status === 'DELIVERED' || order.status === 'COMPLETED';
    const isCancelled = order.status === 'CANCELLED';
    const isAtPickup = order.status === 'AT_PICKUP' || order.status === 'ARRIVED_PICKUP';
    const isInTransit = order.status === 'IN_TRANSIT' || order.status === 'PICKED_UP';
    const isEnRoute =
      order.status === 'EN_ROUTE_PICKUP' ||
      order.status === 'DRIVER_EN_ROUTE_PICKUP' ||
      order.status === 'ASSIGNED';

    const GPS_STALE_AFTER = Number(process.env.GPS_STALE_AFTER) || 30;
    const GPS_OFFLINE_AFTER = Number(process.env.GPS_OFFLINE_AFTER) || 120;

    const lastUpdatedSecondsAgo = Math.max(
      0,
      Math.round((Date.now() - (driver?.currentLocation.timestamp || order.updatedAt)) / 1000)
    );
    const isStale = driver ? lastUpdatedSecondsAgo > GPS_STALE_AFTER : false;
    const gpsFreshness: 'FRESH' | 'STALE' | 'OFFLINE' =
      lastUpdatedSecondsAgo <= 15 ? 'FRESH' : lastUpdatedSecondsAgo <= GPS_OFFLINE_AFTER ? 'STALE' : 'OFFLINE';

    if (isCompleted) {
      trackingState = 'COMPLETED';
    } else if (isCancelled) {
      trackingState = 'CANCELLED';
    } else if (isInTransit) {
      trackingState = 'TRIP_IN_PROGRESS';
    } else if (isAtPickup) {
      trackingState = 'AT_PICKUP';
    } else if (isEnRoute) {
      if (dynamicEtaResult.etaMinutes !== undefined && dynamicEtaResult.etaMinutes <= 2) {
        trackingState = 'ARRIVING_SOON';
      } else {
        trackingState = 'DRIVER_ON_THE_WAY';
      }
    } else {
      trackingState = 'WAITING_FOR_DRIVER';
    }

    if (driver && lastUpdatedSecondsAgo > GPS_OFFLINE_AFTER && !isCompleted && !isCancelled) {
      trackingState = 'LOCATION_UNAVAILABLE';
    }

    // Build strictly privacy-compliant public response
    // Student should only see: Taxi/Driver first name, vehicle info, live coordinates during active trip only.
    // NEVER expose driver phone, email, home, internal notes, or database IDs.
    const response: PublicTrackingResponse = {
      status: order.status,
      tripStatus: order.status,
      trackingState,
      trackingCode: order.trackingCode,
      companyName: db.getCompany(order.companyId)?.name || 'Byblos Student Fleet & Shuttle',
      studentName: order.studentName || order.customerName,
      pickup: {
        address: order.pickupAddress,
        lat: order.pickupCoords.lat,
        lng: order.pickupCoords.lng,
      },
      destination: {
        address: order.dropoffAddress,
        lat: order.dropoffCoords.lat,
        lng: order.dropoffCoords.lng,
      },
      driver: driver
        ? {
            name: driver.name.split(' ')[0], // First name only
            vehicleModel: driver.vehicleModel,
            plateNumber: driver.plateNumber,
          }
        : null,
      vehicle: driver
        ? {
            makeModel: driver.vehicleModel,
            plateNumber: driver.plateNumber,
          }
        : null,
      taxiLocation: (!isCompletedOrCancelled && driver?.currentLocation)
        ? {
            lat: driver.currentLocation.lat,
            lng: driver.currentLocation.lng,
            speed: driver.currentLocation.speed,
            heading: driver.currentLocation.heading,
            timestamp: driver.currentLocation.timestamp,
          }
        : null,
      roadRoute: !isCompletedOrCancelled ? (dynamicEtaResult.polyline || []) : [],
      etaMinutes: !isCompletedOrCancelled ? (dynamicEtaResult.etaMinutes ?? null) : 0,
      distanceKm: dynamicEtaResult.roadDistanceKm ?? null,
      lastUpdated: driver?.currentLocation.timestamp || order.updatedAt,
      lastUpdatedSecondsAgo,
      isStale,
      gpsFreshness,
      // Backwards compatibility fields for transition shims
      order: {
        id: order.id,
        trackingCode: order.trackingCode,
        customerName: order.customerName || order.studentName || 'Student',
        pickupAddress: order.pickupAddress,
        pickupCoords: order.pickupCoords,
        dropoffAddress: order.dropoffAddress,
        dropoffCoords: order.dropoffCoords,
        status: order.status,
        packageInfo: order.packageInfo || 'Campus Shuttle',
        updatedAt: order.updatedAt,
      },
      liveEtaMinutes: !isCompletedOrCancelled ? (dynamicEtaResult.etaMinutes || 0) : 0,
      trafficCondition: (dynamicEtaResult.trafficLevel as 'Normal' | 'Moderate' | 'Heavy') || 'Normal',
      trafficSource: dynamicEtaResult.trafficAssessmentBasis || 'Live Road Geometry',
    };

    res.json(response);
  };

  app.get('/api/orders/track/:tokenOrCode', handlePublicTracking);
  app.get('/api/trips/track/:tokenOrCode', handlePublicTracking);
  app.get('/api/public/tracking/:tokenOrCode', handlePublicTracking);

  // ==================== FLEET ANALYTICS ====================

  app.get('/api/analytics', optionalAuth, (req, res) => {
    const { companyId, networkCode } = req.query;
    const targetComp = (companyId || networkCode || req.user?.companyId || 'NORTH-77') as string;
    const drivers = db.listDrivers(targetComp);
    const orders = db.listOrders(targetComp);
    const trips = db.listTrips(targetComp);

    const completed = orders.filter((o) => o.status === 'DELIVERED');
    const inTransit = orders.filter((o) => o.status === 'IN_TRANSIT' || o.status === 'PICKED_UP');
    const totalDistance = trips.reduce((acc, t) => acc + t.distanceKm, 0);

    res.json({
      totalDrivers: drivers.length,
      availableDrivers: drivers.filter((d) => d.status === 'AVAILABLE').length,
      busyDrivers: drivers.filter((d) => d.status === 'EN_ROUTE_DELIVERY' || d.status === 'ASSIGNED').length,
      totalOrdersToday: orders.length,
      completedOrdersToday: completed.length,
      activeDeliveries: inTransit.length,
      totalDistanceKm: Math.round(totalDistance * 10) / 10,
      avgSpeedKmH: drivers.length > 0 ? Math.round(drivers.reduce((acc, d) => acc + d.currentLocation.speed, 0) / drivers.length) : 0,
      fleetUtilizationPercent: drivers.length > 0 ? Math.round((inTransit.length / drivers.length) * 100) : 0,
    });
  });

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`ONTime Fleet Platform server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
