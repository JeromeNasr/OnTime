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
  verifyToken,
  AuthUserPayload,
} from './src/server/auth';
import { calculateRoadRoute, haversineKm } from './src/server/routing';
import { calculateDynamicEta, EtaCalculationResult } from './src/server/eta';
import { Trip, DriverLocation, TripStatus, PublicTrackingResponse, StudentTrackingState } from './src/types';

async function startServer() {
  const isDriverRole = (role?: string): boolean => role === 'DRIVER' || role === 'LEAD_DRIVER';
  const app = express();
  const PORT = 3000;
  const httpServer = http.createServer(app);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS configuration (Audited for production)
  const configuredOrigins = [
    ...(process.env.FRONTEND_URL || '').split(','),
    ...(process.env.SOCKET_ORIGIN || '').split(','),
    process.env.APP_URL || '',
  ]
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
    return callback(null, false);
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

  // Socket.IO Room Management with Strict Auth Validation
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
        }
      }
    });

    // Student or dispatcher joins specific trip tracking room
    const handleJoinTrip = (payload: any) => {
      const trackingToken = typeof payload === 'string' ? payload : payload?.trackingToken;
      const authToken = typeof payload === 'object' ? payload?.token : undefined;

      // 1. Authenticated company user or assigned driver
      if (authToken) {
        const user = verifyToken(authToken);
        if (!user) {
          socket.emit('error', { code: 'UNAUTHORIZED', message: 'Authentication required' });
          return;
        }
        const tripId = typeof payload === 'object' ? (payload.tripId || payload.trackingToken) : undefined;
        const trip = tripId ? db.getTrip(tripId) : null;
        if (!trip) {
          socket.emit('error', { code: 'NOT_FOUND', message: 'Trip not found' });
          return;
        }
        if (isDriverRole(user.role)) {
          const drv = db.getDriverByUserId(user.id);
          if (!drv || trip.assignedDriverId !== drv.id) {
            socket.emit('error', { code: 'FORBIDDEN', message: 'Unauthorized driver trip access' });
            return;
          }
        } else if (user.companyId !== trip.companyId) {
          socket.emit('error', { code: 'FORBIDDEN', message: 'Unauthorized company trip access' });
          return;
        }
        socket.join(`trip:${trip.id}`);
        socket.emit('joined:trip', { tripId: trip.id });
        return;
      }

      // 2. Unauthenticated public/student tracking: ONLY allowed via valid trackingToken
      if (!trackingToken || typeof trackingToken !== 'string') {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Tracking token required for trip tracking' });
        return;
      }

      let trip = db.getTripByToken(trackingToken);
      if (!trip && (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production')) {
        trip = db.getTripByTracking(trackingToken);
      }

      if (!trip) {
        socket.emit('error', { code: 'NOT_FOUND', message: 'Trip not found or link expired' });
        return;
      }

      const now = Date.now();
      const expiresAt = trip.tokenExpiresAt || (trip.createdAt + 48 * 3600 * 1000);
      if (now > expiresAt || trip.tokenRevoked) {
        socket.emit('error', { code: 'FORBIDDEN', message: 'Tracking link has expired' });
        return;
      }

      // Join ONLY canonical trip room
      socket.join(`trip:${trip.id}`);
      socket.emit('joined:trip', { tripId: trip.id });
    };

    socket.on('join:trip', handleJoinTrip);

    // Driver joins personal push room with token verification
    socket.on('join:driver', (payload: any) => {
      let driverId = typeof payload === 'string' ? payload : payload?.driverId;
      if (typeof payload === 'object' && payload?.token) {
        const user = verifyToken(payload.token);
        if (user) {
          if (isDriverRole(user.role)) {
            const drv = db.getDriverByUserId(user.id);
            if (!drv) {
              socket.emit('error', { code: 'FORBIDDEN', message: 'Driver not found' });
              return;
            }
            driverId = drv.id;
          } else {
            // Dispatcher can join driver room within their own company only
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

    // Public Customer Live Vehicle Map channel
    socket.on('join:public_fleet', () => {
      socket.join('public_fleet');
      // Immediately send current live public vehicles snapshot
      const snapshot = db.listPublicVehicles();
      socket.emit('fleet:snapshot', snapshot);
    });

    socket.on('leave:public_fleet', () => {
      socket.leave('public_fleet');
    });

    socket.on('disconnect', () => {
      // client disconnected cleanly
    });
  });

  // Health check
  app.get('/api/health', async (_req, res) => {
    const health = await db.checkHealth();
    if (!health.healthy) {
      return res.status(503).json({
        status: 'unhealthy',
        database: 'disconnected',
        error: health.error,
        service: 'ONTime Fleet Tracking Platform',
        version: '2.0.0-production',
        time: new Date().toISOString(),
      });
    }
    res.json({
      status: 'ok',
      database: 'connected',
      service: 'ONTime Fleet Tracking Platform',
      version: '2.0.0-production',
      region: 'Jbeil (Byblos) University Dorm Corridor',
      time: new Date().toISOString(),
    });
  });

  // ==================== AUTHENTICATION API ====================

  app.post('/api/auth/register', async (req, res) => {
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
        const generatedCode = `BYB-${crypto.randomInt(100, 999)}`;
        const newComp = await db.createCompany({
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
      const user = await db.createUser({
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
    if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Demo login is disabled in production.' } });
    }

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

  const listPublicNetworksHandler = (_req: express.Request, res: express.Response) => {
    const rawNetworks = db.listPublicNetworks();
    const publicNetworks = rawNetworks.map((net) => ({
      id: net.id,
      code: net.code,
      name: net.name,
      ownerName: net.ownerName,
      leadDriverName: net.leadDriverName,
      leadPhone: net.settings?.enablePublicDriverPhone === true ? net.leadPhone : undefined,
      activeVehicleCount: net.activeVehicleCount ?? 0,
      createdAt: net.createdAt,
    }));
    res.json(publicNetworks);
  };

  app.get('/api/networks', listPublicNetworksHandler);
  app.get('/api/public/networks', listPublicNetworksHandler);

  app.get('/api/networks/:code', (req, res) => {
    const net = db.getNetworkByJoinCode(req.params.code) || db.getCompany(req.params.code);
    if (!net) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Fleet network not found' } });
    }
    res.json(net);
  });

  app.get('/api/companies', (_req, res) => {
    res.json(db.listCompanies());
  });

  app.post('/api/networks', requireAuth, async (req, res) => {
    if (req.user!.role !== 'LEAD_DRIVER' && req.user!.role !== 'OWNER') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Only authorized lead drivers or fleet owners can create networks' },
      });
    }

    const { name, ownerName, ownerEmail, phone, leadPhone, joinCode } = req.body;
    if (!name) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Network name is required' } });
    }
    const cleanJoinCode = joinCode ? String(joinCode).trim().toUpperCase() : String(crypto.randomInt(100000, 999999));
    const comp = await db.createCompany({
      code: `NET-${crypto.randomInt(100, 999)}`,
      name: name.trim(),
      ownerName: (ownerName || req.user!.name).trim(),
      ownerEmail: ownerEmail || req.user!.email || `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@northlebanonfleet.lb`,
      phone: phone || leadPhone || req.user!.phone || '+961 70 000 000',
      leadPhone: leadPhone || phone || req.user!.phone,
      joinCode: cleanJoinCode,
      isPublic: true,
    });
    res.status(201).json(comp);
  });

  app.post('/api/networks/:id/lead', requireAuth, async (req, res) => {
    const { leadDriverId, leadPhone } = req.body;
    if (!leadDriverId) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Lead driver ID required' } });
    }
    const comp = db.getCompany(req.params.id);
    if (!comp) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Network not found' } });
    }
    if (req.user!.companyId !== comp.id && req.user!.role !== 'OWNER') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Unauthorized to manage this network' } });
    }
    if (req.user!.companyId !== comp.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot modify lead driver of another network' } });
    }
    const updated = await db.updateNetworkLead(req.params.id, leadDriverId, leadPhone);
    if (!updated) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Network not found' } });
    }
    res.json(updated);
  });

  app.post('/api/companies', requireAuth, async (req, res) => {
    if (req.user!.role !== 'OWNER') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Owner privileges required' } });
    }
    const { name, ownerName, ownerEmail } = req.body;
    if (!name || !ownerName) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Company name and owner name required' } });
    }
    const comp = await db.createCompany({
      code: `BYB-${crypto.randomInt(100, 999)}`,
      name,
      ownerName,
      ownerEmail: ownerEmail || 'owner@ontime.lb',
    });
    res.status(201).json(comp);
  });

  app.get('/api/companies/:id/invites', requireAuth, async (req, res) => {
    const comp = db.getCompany(req.params.id);
    if (!comp) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Company not found' } });
    if (req.user!.companyId !== comp.id) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot generate invites for another company.' } });
    }
    const invite = await db.createInvite(comp.id, 'DRIVER');
    res.json(invite);
  });

  // ==================== PUBLIC FLEET TRACKING API ====================

  app.get('/api/public/vehicles', (req, res) => {
    const networkParam = (req.query.networkIds || req.query.networks) as string | undefined;
    const networkIds = networkParam ? networkParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const vehicles = db.listPublicVehicles(networkIds);
    res.json(vehicles);
  });

  // Standalone Public ETA Endpoint (Zero Trip / Zero Order dependency)
  app.post('/api/public/eta', async (req, res) => {
    const { vehicleLat, vehicleLng, vehicleSpeed, customerLat, customerLng, vehicleId } = req.body;

    const vLat = Number(vehicleLat);
    const vLng = Number(vehicleLng);
    const cLat = Number(customerLat);
    const cLng = Number(customerLng);

    if (isNaN(vLat) || isNaN(vLng) || isNaN(cLat) || isNaN(cLng)) {
      return res.status(400).json({
        error: { code: 'INVALID_COORDINATES', message: 'Valid vehicle and customer latitude/longitude are required' },
      });
    }

    try {
      const etaResult = await calculateDynamicEta({
        tripId: vehicleId ? `public-eta-${vehicleId}` : undefined,
        driverLocation: {
          lat: vLat,
          lng: vLng,
          speed: typeof vehicleSpeed === 'number' && !isNaN(vehicleSpeed) ? Math.max(0, vehicleSpeed) : 35,
        },
        destinationCoords: {
          lat: cLat,
          lng: cLng,
        },
      });

      res.json({
        etaMinutes: etaResult.etaMinutes,
        roadDistanceKm: etaResult.roadDistanceKm,
        polyline: etaResult.polyline,
        trafficLevel: etaResult.trafficLevel,
        trafficAssessmentBasis: etaResult.trafficAssessmentBasis,
        source: etaResult.source,
      });
    } catch (err) {
      console.warn('Public ETA calculation error, using fallback:', err);
      const distKm = haversineKm(vLat, vLng, cLat, cLng);
      const estMinutes = Math.max(1, Math.round((distKm / 35) * 60) + 2);
      res.json({
        etaMinutes: estMinutes,
        roadDistanceKm: Math.round(distKm * 10) / 10,
        polyline: [[vLat, vLng], [cLat, cLng]],
        trafficLevel: 'Normal',
        trafficAssessmentBasis: 'Direct distance estimate (road routing unavailable)',
        source: 'STRAIGHT_LINE_FALLBACK',
      });
    }
  });

  // ==================== DRIVERS & FLEET ====================

  app.get('/api/drivers', requireAuth, (req, res) => {
    // Strict company isolation: authenticated user's company is strictly authoritative
    const targetCompany = req.user!.companyId;
    const drivers = db.listDrivers(targetCompany);
    res.json(drivers);
  });

  app.get('/api/drivers/:id', requireAuth, (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Driver not found' } });
    if (driver.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot access driver belonging to another company.' } });
    }
    res.json(driver);
  });

  app.post('/api/drivers/join', async (req, res) => {
    const { name, phone, vehicleModel, plateNumber, networkCode, isLeadDriver } = req.body;
    const code = (networkCode || '').toUpperCase();
    const comp = db.getNetworkByJoinCode(code) || db.getCompany(code);
    if (!comp) {
      return res.status(404).json({ error: 'Invalid company / network code' });
    }

    const driver = await db.createDriver({
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

  // Driver Join Network using Join Code
  app.post('/api/driver/join-network', requireAuth, async (req, res) => {
    let driverId: string | undefined;
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      driverId = drv ? drv.id : req.user!.id;
    } else {
      driverId = req.body.driverId;
    }

    const { joinCode } = req.body;
    if (!joinCode) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Join code is required' } });
    }

    const network = db.getNetworkByJoinCode(joinCode);
    if (!network) {
      return res.status(404).json({ error: { code: 'NETWORK_NOT_FOUND', message: 'No fleet network found with this code' } });
    }

    const updated = await db.updateDriverNetwork(driverId!, network.id, false);
    if (!updated) {
      return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver profile not found' } });
    }

    io.to(`company:${network.id}`).emit('driver:joined', updated);
    res.json({ success: true, driver: updated, network });
  });

  // Driver Toggle Broadcasting (Location Sharing & Speedometer)
  app.post('/api/driver/broadcasting', requireAuth, async (req, res) => {
    let driverId: string | undefined;
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      driverId = drv ? drv.id : req.user!.id;
    } else {
      driverId = req.body.driverId;
      if (driverId) {
        const targetDriver = db.getDriver(driverId);
        if (!targetDriver || targetDriver.companyId !== req.user!.companyId) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot modify broadcasting for driver belonging to another company' } });
        }
      }
    }

    if (!driverId) {
      return res.status(400).json({ error: { code: 'INVALID_DRIVER', message: 'Driver not found' } });
    }

    const { locationSharingEnabled, speedometerEnabled } = req.body;
    const isLocSharing = Boolean(locationSharingEnabled);
    const speedo = speedometerEnabled !== undefined ? Boolean(speedometerEnabled) : undefined;

    const updated = await db.setDriverBroadcasting(driverId, isLocSharing, speedo);
    if (!updated) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Driver not found' } });
    }

    // Broadcast to public fleet channel
    if (!isLocSharing) {
      io.to('public_fleet').emit('vehicle:removed', { driverId: updated.id });
    } else {
      const publicVehicles = db.listPublicVehicles();
      const veh = publicVehicles.find((v) => v.driverId === updated.id);
      if (veh) {
        io.to('public_fleet').emit('vehicle:location:update', veh);
      }
    }

    io.to(`company:${updated.companyId}`).emit('driver:broadcasting_changed', {
      driverId: updated.id,
      locationSharingEnabled: updated.locationSharingEnabled,
      speedometerEnabled: updated.speedometerEnabled,
    });

    res.json(updated);
  });

  // Driver Leave Current Network
  app.post('/api/driver/leave-network', requireAuth, async (req, res) => {
    let driverId: string | undefined;
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      driverId = drv ? drv.id : req.user!.id;
    } else {
      driverId = req.body.driverId;
      if (driverId) {
        const targetDriver = db.getDriver(driverId);
        if (!targetDriver || targetDriver.companyId !== req.user!.companyId) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot remove driver belonging to another company' } });
        }
      }
    }

    if (!driverId) {
      return res.status(400).json({ error: { code: 'INVALID_DRIVER', message: 'Driver not found' } });
    }

    const driver = db.getDriver(driverId);
    if (!driver) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Driver not found' } });
    }

    const oldCompId = driver.companyId;
    await db.removeDriverFromNetwork(driverId);
    io.to('public_fleet').emit('vehicle:removed', { driverId });
    if (oldCompId) {
      io.to(`company:${oldCompId}`).emit('driver:left', { driverId });
    }

    res.json({ success: true, message: 'Disconnected from fleet network' });
  });

  // In-memory rate limiting map for public tracking endpoint (max 80 requests/minute per client)
  const trackingRateLimits = new Map<string, { count: number; resetTime: number }>();

  // Periodic pruning of stale rate-limit entries (bounded memory)
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of trackingRateLimits.entries()) {
      if (now >= record.resetTime) {
        trackingRateLimits.delete(ip);
      }
    }
    if (trackingRateLimits.size > 5000) {
      let pruned = 0;
      for (const ip of trackingRateLimits.keys()) {
        trackingRateLimits.delete(ip);
        pruned++;
        if (pruned > 1000) break;
      }
    }
  }, 5 * 60 * 1000).unref();

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
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      const authorizedDriverId = drv ? drv.id : req.user!.id;
      if (targetDriverId && targetDriverId !== authorizedDriverId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers can only report location for their own vehicle' } });
      }
      driverId = authorizedDriverId;
    } else if (req.user!.role === 'DISPATCHER' || req.user!.role === 'OWNER') {
      if (!driverId) {
        return res.status(400).json({ error: { code: 'MISSING_DRIVER_ID', message: 'Driver ID required for administrative telemetry' } });
      }
      const targetDriver = db.getDriver(driverId);
      if (!targetDriver || targetDriver.companyId !== req.user!.companyId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot report telemetry for driver belonging to another company' } });
      }
    }

    if (isSimulated && process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Simulated GPS telemetry is rejected in production' } });
    }

    if (!driverId) {
      return res.status(400).json({ error: { code: 'INVALID_DRIVER', message: 'Driver identifier required' } });
    }

    const existingDriver = db.getDriver(driverId);
    if (!existingDriver) {
      return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });
    }

    // Reject telemetry if associated trip is completed or cancelled
    const targetTripId = (req.body.tripId || existingDriver.currentTripId) as string | undefined;
    if (targetTripId) {
      const associatedTrip = db.getTrip(targetTripId);
      if (associatedTrip && (associatedTrip.status === 'COMPLETED' || associatedTrip.status === 'CANCELLED')) {
        return res.status(400).json({
          error: {
            code: 'TRIP_TERMINATED',
            message: `Cannot submit telemetry for a ${associatedTrip.status.toLowerCase()} trip.`,
          },
        });
      }
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

    const rawSpeed = Number(speed);
    if (!isNaN(rawSpeed) && rawSpeed > 180) {
      return res.status(400).json({ error: { code: 'SPEED_OUT_OF_BOUNDS', message: 'Reported vehicle speed exceeds physical limit (>180 km/h)' } });
    }

    // Check impossible speed / teleportation against previous ping
    if (existingDriver.currentLocation && existingDriver.currentLocation.timestamp > 0 && !isSimulated) {
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

    // Clamp speed to realistic max 150 km/h, and calculate if missing/zero
    let cleanSpeed = rawSpeed;
    let isCalculatedSpeed = false;
    if ((isNaN(rawSpeed) || rawSpeed <= 0) && existingDriver.currentLocation && existingDriver.currentLocation.timestamp > 0) {
      const timeDeltaSec = (pingTimestamp - existingDriver.currentLocation.timestamp) / 1000;
      if (timeDeltaSec >= 1 && timeDeltaSec <= 120) {
        const distKm = haversineKm(
          existingDriver.currentLocation.lat,
          existingDriver.currentLocation.lng,
          numLat,
          numLng
        );
        cleanSpeed = distKm / (timeDeltaSec / 3600);
        isCalculatedSpeed = true;
      }
    }
    cleanSpeed = Math.min(150, Math.max(0, cleanSpeed || 0));

    const cleanHeading = (heading !== undefined && heading !== null && !isNaN(Number(heading))) ? Number(heading) : null;

    try {
      const updated = await db.updateDriverLocation(driverId, {
        lat: numLat,
        lng: numLng,
        speed: cleanSpeed,
        heading: cleanHeading,
        accuracy: Math.min(200, Number(accuracy) || 5),
        timestamp: pingTimestamp,
        batteryLevel: batteryLevel !== undefined ? Number(batteryLevel) : undefined,
        networkStatus,
        isSimulated: Boolean(isSimulated),
        isCalculatedSpeed,
      } as any);

      if (!updated) {
        return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });
      }

      // 1. Broadcast to Company Room in real-time
      io.to(`company:${updated.companyId || updated.networkCode}`).emit('driver:location', {
        driverId: updated.id,
        location: updated.currentLocation,
        status: updated.status,
      });

      // 2. Broadcast to Public Fleet Map channel if location sharing is enabled
      if (updated.locationSharingEnabled !== false) {
        const comp = updated.companyId ? db.getCompany(updated.companyId) : null;
        const vehicle = updated.vehicleId ? db.getVehicle(updated.vehicleId) : null;
        const speedDisplay = (updated.speedometerEnabled !== false)
          ? (typeof updated.currentLocation.speed === 'number' && !isNaN(updated.currentLocation.speed) ? Math.round(updated.currentLocation.speed) : null)
          : null;

        const headingDisplay = (typeof updated.currentLocation.heading === 'number' && !isNaN(updated.currentLocation.heading))
          ? updated.currentLocation.heading
          : null;

        const publicVehicleItem = {
          id: `veh-${updated.id}`,
          driverId: updated.id,
          driverName: updated.name,
          phone: comp?.settings?.enablePublicDriverPhone === true ? updated.phone : undefined,
          networkId: updated.companyId,
          networkCode: updated.networkCode,
          networkName: updated.networkName || comp?.name || updated.networkCode,
          leadDriverName: comp?.ownerName,
          leadPhone: comp?.settings?.enablePublicDriverPhone === true ? (comp?.leadPhone || comp?.phone) : undefined,
          vehicleModel: vehicle?.makeModel || updated.vehicleModel || 'Taxi Sedan',
          plateNumber: vehicle?.plateNumber || updated.plateNumber || 'Public Taxi',
          status: 'ONLINE',
          location: {
            lat: updated.currentLocation.lat,
            lng: updated.currentLocation.lng,
            speed: speedDisplay,
            heading: headingDisplay,
            accuracy: updated.currentLocation.accuracy ?? null,
            timestamp: updated.currentLocation.timestamp,
            isCalculatedSpeed: isCalculatedSpeed || updated.currentLocation.isCalculatedSpeed,
            freshness: 'FRESH',
          },
          locationSharingEnabled: true,
          speedometerEnabled: updated.speedometerEnabled !== false,
        };
        io.to('public_fleet').emit('vehicle:location:update', publicVehicleItem);
      } else {
        io.to('public_fleet').emit('vehicle:removed', { driverId: updated.id });
      }

      // 3. If driver is on an active trip, compute dynamic ETA and broadcast to canonical trip room
      const activeTripId = updated.currentTripId || (req.body.tripId ? db.getTrip(req.body.tripId)?.id : undefined);
      if (activeTripId) {
        const trip = db.getTrip(activeTripId);
        if (trip) {
          io.to(`trip:${trip.id}`).emit('driver:location', { driverId: updated.id, location: updated.currentLocation });
          io.to(`trip:${trip.id}`).emit('driver:location_updated', { driverId: updated.id, location: updated.currentLocation });

          if (trip.dropoffCoords) {
            try {
              const etaResult = await calculateDynamicEta({
                tripId: trip.id,
                driverLocation: updated.currentLocation,
                destinationCoords: (trip.status === 'EN_ROUTE_PICKUP' || trip.status === 'AT_PICKUP') ? trip.pickupCoords : trip.dropoffCoords,
              });

              trip.estimatedMinutes = etaResult.etaMinutes;
              trip.roadDistanceKm = etaResult.roadDistanceKm;

              const etaPayload = {
                tripId: trip.id,
                driverLocation: updated.currentLocation,
                etaMinutes: etaResult.etaMinutes,
                roadDistanceKm: etaResult.roadDistanceKm,
                polyline: etaResult.polyline,
                trafficLevel: etaResult.trafficLevel,
                trafficSource: etaResult.trafficAssessmentBasis,
              };

              io.to(`trip:${trip.id}`).emit('trip:eta_update', etaPayload);
            } catch (err) {
              console.warn('Live ETA calculation error:', err);
            }
          }
        }
      }

      res.json({ success: true, driverId, location: updated.currentLocation });
    } catch (err) {
      console.error('Failed to update driver location in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to record driver telemetry due to database error' } });
    }
  };

  app.post('/api/telemetry', requireAuth, telemetryHandler);
  app.post('/api/drivers/:id/location', requireAuth, telemetryHandler);

  // Offline Sync: Batch telemetry upload on reconnection
  app.post('/api/telemetry/batch', requireAuth, async (req, res) => {
    const { driverId: reqDriverId, points } = req.body;
    let driverId = reqDriverId;
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      const authorizedDriverId = drv ? drv.id : req.user!.id;
      if (reqDriverId && reqDriverId !== authorizedDriverId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Unauthorized driver telemetry batch' } });
      }
      driverId = authorizedDriverId;
    } else if (req.user!.role === 'DISPATCHER' || req.user!.role === 'OWNER') {
      if (!driverId) {
        return res.status(400).json({ error: { code: 'MISSING_DRIVER_ID', message: 'Driver ID required for administrative batch' } });
      }
      const targetDriver = db.getDriver(driverId);
      if (!targetDriver || targetDriver.companyId !== req.user!.companyId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot upload telemetry for driver belonging to another company' } });
      }
    }

    if (!driverId || !Array.isArray(points)) {
      return res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Invalid batch points payload' } });
    }

    const driver = db.getDriver(driverId);
    if (!driver) return res.status(404).json({ error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' } });

    // Sanitize and validate batch points
    const now = Date.now();
    const validPoints: DriverLocation[] = [];
    for (const pt of points) {
      const lat = Number(pt.lat);
      const lng = Number(pt.lng);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const ptTime = Number(pt.timestamp) || now;
      if (ptTime > now + 15000) continue; // Reject future timestamps
      if (now - ptTime > 24 * 60 * 60 * 1000) continue; // Reject older than 24 hours
      const ptSpeed = Number(pt.speed) || 0;
      if (ptSpeed > 180 || ptSpeed < 0) continue;

      const ptHeading = (pt.heading !== undefined && pt.heading !== null && !isNaN(Number(pt.heading))) ? Number(pt.heading) : null;

      validPoints.push({
        lat,
        lng,
        speed: Math.min(150, Math.max(0, ptSpeed)),
        heading: ptHeading,
        accuracy: Math.min(200, Number(pt.accuracy) || 5),
        timestamp: ptTime,
        batteryLevel: pt.batteryLevel !== undefined ? Number(pt.batteryLevel) : undefined,
        networkStatus: pt.networkStatus,
        isSimulated: Boolean(pt.isSimulated),
      });
    }

    validPoints.sort((a, b) => a.timestamp - b.timestamp);
    try {
      for (const pt of validPoints) {
        const ptTripId = (pt as any).tripId || driver.currentTripId;
        if (ptTripId) {
          const t = db.getTrip(ptTripId);
          if (t && (t.status === 'COMPLETED' || t.status === 'CANCELLED')) {
            continue;
          }
        }
        await db.updateDriverLocation(driverId, pt);
      }
      res.json({ success: true, syncedCount: validPoints.length });
    } catch (err) {
      console.error('Failed to sync batch telemetry in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to record batch telemetry due to database error' } });
    }
  });

  // ==================== TRIPS ====================

  app.post('/api/drivers/:id/trip/start', requireAuth, async (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Driver not found' } });

    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      if (drv && drv.id !== driver.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot start trip for another driver' } });
      }
    } else if (driver.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot start trip for driver in another company' } });
    }

    // Connect to canonical trip assigned to this driver
    let assignedTripId = driver.currentTripId;
    let canonicalTrip = assignedTripId ? db.getTrip(assignedTripId) : null;

    // Fallback: look up active trip assigned to driver if ID pointer was unlinked
    if (!canonicalTrip) {
      const activeTrips = db.listActiveTrips(driver.companyId);
      canonicalTrip = activeTrips.find(
        (t) => t.assignedDriverId === driver.id && t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
      ) || null;
      if (canonicalTrip) {
        driver.currentTripId = canonicalTrip.id;
      }
    }

    if (!canonicalTrip) {
      return res.status(400).json({
        error: {
          code: 'NO_ASSIGNED_TRIP',
          message: 'No active dorm shuttle trip is currently assigned to this driver. Please wait for dispatch.',
        },
      });
    }

    try {
      if (canonicalTrip.status === 'CREATED' || canonicalTrip.status === 'ASSIGNED') {
        await db.updateTripStatus(canonicalTrip.id, 'EN_ROUTE_PICKUP', 'Driver started trip towards campus dorm pickup');
        const payload = { tripId: canonicalTrip.id, status: 'EN_ROUTE_PICKUP', timestamp: Date.now() };
        io.to(`trip:${canonicalTrip.id}`).emit('trip:status_changed', payload);
      }

      io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:started', {
        driverId: driver.id,
        tripId: canonicalTrip.id,
      });
      io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:updated', canonicalTrip);

      res.json({ success: true, trip: canonicalTrip });
    } catch (err) {
      console.error('Failed to start trip in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to start trip due to database error' } });
    }
  });

  app.post('/api/drivers/:id/trip/stop', requireAuth, async (req, res) => {
    const driver = db.getDriver(req.params.id);
    if (!driver) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Driver not found' } });
    }

    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      if (drv && drv.id !== driver.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot stop trip for another driver' } });
      }
    } else if (driver.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot stop trip for driver in another company' } });
    }

    const assignedTripId = driver.currentTripId;
    let canonicalTrip = assignedTripId ? db.getTrip(assignedTripId) : null;
    if (!canonicalTrip) {
      const activeTrips = db.listActiveTrips(driver.companyId);
      canonicalTrip = activeTrips.find(
        (t) => t.assignedDriverId === driver.id && t.status !== 'COMPLETED' && t.status !== 'CANCELLED'
      ) || null;
    }

    if (!canonicalTrip) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'No active trip to end' } });
    }

    const startTime = canonicalTrip.startedAt || canonicalTrip.createdAt || Date.now() - 600000;
    const durationMinutes = Math.max(1, Math.round((Date.now() - startTime) / 60000));
    const distanceKm = canonicalTrip.roadDistanceKm || 2.0;
    const avgSpeed = durationMinutes > 0 ? (distanceKm / (durationMinutes / 60)) : 25;

    try {
      if (canonicalTrip.status !== 'COMPLETED' && canonicalTrip.status !== 'CANCELLED') {
        await db.updateTripStatus(canonicalTrip.id, 'COMPLETED', 'Trip completed by driver at destination');
        const payload = { tripId: canonicalTrip.id, status: 'COMPLETED', timestamp: Date.now() };
        io.to(`trip:${canonicalTrip.id}`).emit('trip:status_changed', payload);
      }

      const completedTrip = await db.saveTripLog({
        id: `log-${canonicalTrip.id}`,
        tripId: canonicalTrip.id,
        driverId: driver.id,
        driverName: driver.name,
        companyId: driver.companyId,
        networkCode: driver.networkCode,
        vehicleId: driver.vehicleId,
        startTime,
        endTime: Date.now(),
        startAddress: canonicalTrip.pickupAddress,
        endAddress: canonicalTrip.dropoffAddress,
        distanceKm: Math.round(distanceKm * 10) / 10,
        durationMinutes,
        avgSpeedKmH: Math.round(avgSpeed * 10) / 10,
        maxSpeedKmH: 45,
        idleMinutes: Math.round(durationMinutes * 0.15),
        movingMinutes: Math.round(durationMinutes * 0.85),
        path: canonicalTrip.routeGeometry || [],
        status: 'COMPLETED',
      });

      driver.status = 'AVAILABLE';
      delete driver.currentTripId;

      io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:completed', completedTrip);
      io.to(`company:${driver.companyId || driver.networkCode}`).emit('trip:updated', canonicalTrip);

      res.json({ success: true, completedTrip, trip: canonicalTrip });
    } catch (err) {
      console.error('Failed to stop trip in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to stop trip due to database error' } });
    }
  });

  // Historical completed trip logs
  const listTripHistoryHandler = (req: express.Request, res: express.Response) => {
    const { driverId } = req.query;
    const targetComp = req.user!.companyId;
    const trips = db.listTripLogs(targetComp, driverId as string | undefined);
    res.json(trips);
  };

  app.get('/api/trips/history', requireAuth, listTripHistoryHandler);
  app.get('/api/trip-logs', requireAuth, listTripHistoryHandler);

  // ==================== VEHICLES ====================

  app.get('/api/vehicles', requireAuth, (req, res) => {
    const companyId = req.user!.companyId;
    const vehicles = db.listVehicles(companyId);
    res.json(vehicles);
  });

  // ==================== TRIPS & DISPATCH ====================

  const listTripsHandler = (req: express.Request, res: express.Response) => {
    const { driverId } = req.query;
    // Strict isolation: authenticated user's company is authoritative
    const targetComp = req.user!.companyId;
    let trips = db.listActiveTrips(targetComp);

    // If authenticated user is a driver, only return trips assigned to them
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      if (drv) {
        trips = trips.filter((t) => t.assignedDriverId === drv.id);
      } else {
        trips = [];
      }
    } else if (driverId) {
      trips = trips.filter((t) => t.assignedDriverId === driverId);
    }
    res.json(trips);
  };

  const getTripHandler = (req: express.Request, res: express.Response) => {
    const trip = db.getTrip(req.params.id);
    if (!trip) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }
    // Company isolation
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      if (!drv || trip.assignedDriverId !== drv.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied: Driver can only view their own assigned trip' } });
      }
    } else if (trip.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied to trip from another company' } });
    }
    res.json(trip);
  };

  app.get('/api/trips', requireAuth, listTripsHandler);
  app.get('/api/trips/:id', requireAuth, getTripHandler);

  const createTripHandler = async (req: express.Request, res: express.Response) => {
    if (isDriverRole(req.user!.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers cannot create dispatch trips.' } });
    }

    const {
      studentName,
      studentPhone,
      pickupAddress,
      pickupCoords,
      dropoffAddress,
      dropoffCoords,
      notes,
      assignedDriverId,
      priority,
    } = req.body;

    const authoritativeCompanyId = req.user!.companyId;
    const comp = db.getCompany(authoritativeCompanyId);
    if (!comp) return res.status(400).json({ error: { code: 'INVALID_COMPANY', message: 'Valid company required' } });

    // Validate driver assignment belongs to the authoritative company
    if (assignedDriverId) {
      const assignedDrv = db.getDriver(assignedDriverId);
      if (!assignedDrv || assignedDrv.companyId !== comp.id) {
        return res.status(400).json({ error: { code: 'INVALID_DRIVER_ASSIGNMENT', message: 'Assigned driver does not belong to this company.' } });
      }
    }

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

    try {
      const newTrip = await db.createTrip({
        companyId: comp.id,
        studentName: (studentName || 'Student').trim(),
        studentPhone: (studentPhone || '').trim(),
        pickupAddress: pickupAddress || 'Campus Crest Dorms, Blat',
        pickupCoords: pickupCoords || { lat: 34.1215, lng: 35.663 },
        dropoffAddress: dropoffAddress || 'LAU Byblos - Upper Gate',
        dropoffCoords: dropoffCoords || { lat: 34.1238, lng: 35.6698 },
        notes: (notes || 'Campus Dorm Shuttle').trim(),
        priority: priority || 'normal',
        assignedDriverId,
        roadDistanceKm,
        estimatedMinutes,
        routeGeometry,
      });

      // Realtime broadcast to company dispatch room
      io.to(`company:${comp.id}`).emit('trip:created', newTrip);

      // If driver assigned, push to driver room
      if (assignedDriverId) {
        io.to(`driver:${assignedDriverId}`).emit('trip:assigned', newTrip);
      }

      res.status(201).json(newTrip);
    } catch (err) {
      console.error('Failed to create trip in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to create trip due to database error' } });
    }
  };

  app.post('/api/trips', requireAuth, createTripHandler);

  const assignTripHandler = async (req: express.Request, res: express.Response) => {
    if (isDriverRole(req.user!.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers cannot assign or reassign trips.' } });
    }

    const { driverId } = req.body;
    const authCompanyId = req.user!.companyId;

    if (driverId) {
      const targetDriver = db.getDriver(driverId);
      if (!targetDriver || targetDriver.companyId !== authCompanyId) {
        return res.status(400).json({ error: { code: 'INVALID_DRIVER', message: 'Assigned driver must belong to your company.' } });
      }
    }

    try {
      const result = await db.assignTrip(req.params.id, driverId, authCompanyId);
      if (!result) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
      }
      if ('error' in result) {
        return res.status(400).json({ error: { code: 'ASSIGNMENT_ERROR', message: result.error } });
      }

      const trip = result;
      io.to(`company:${trip.companyId || trip.networkCode}`).emit('trip:updated', trip);
      if (driverId) {
        io.to(`driver:${driverId}`).emit('trip:assigned', trip);
      }

      res.json(trip);
    } catch (err) {
      console.error('Failed to assign trip in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to assign trip due to database error' } });
    }
  };

  app.patch('/api/trips/:id/assign', requireAuth, assignTripHandler);

  const updateStatusHandler = async (req: express.Request, res: express.Response) => {
    const { note } = req.body;
    const status = (req.body.status as string)?.toUpperCase();
    const existing = db.getTrip(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
    }

    // Role-based authorization: driver can only update assigned trips; company can only update its own trips
    if (isDriverRole(req.user!.role)) {
      const drv = db.getDriverByUserId(req.user!.id);
      if (!drv || existing.assignedDriverId !== drv.id) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Drivers can only update trips assigned to them.' } });
      }
    } else if (existing.companyId !== req.user!.companyId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Cannot modify trips belonging to another company.' } });
    }

    try {
      const result = await db.updateTripStatus(req.params.id, status as TripStatus, note);
      if (!result) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Trip not found' } });
      }
      if ('error' in result) {
        return res.status(422).json({ error: { code: 'INVALID_TRANSITION', message: result.error } });
      }

      const trip = result;
      io.to(`company:${trip.companyId || trip.networkCode}`).emit('trip:updated', trip);

      const statusPayload = {
        tripId: trip.id,
        status: trip.status,
        timestamp: Date.now(),
        note,
      };
      io.to(`trip:${trip.id}`).emit('trip:status_changed', statusPayload);

      res.json(trip);
    } catch (err) {
      console.error('Failed to update trip status in database:', err);
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to update trip status due to database error' } });
    }
  };

  app.patch('/api/trips/:id/status', requireAuth, updateStatusHandler);

  // ==================== SECURE STUDENT & PUBLIC TRACKING API ====================

  const handlePublicTracking = async (req: express.Request, res: express.Response) => {
    // Rate limit by IP (80 requests per 60 seconds) and by tracking token (60 req/min)
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rateRecord = trackingRateLimits.get(clientIp);
    if (rateRecord && now < rateRecord.resetTime) {
      rateRecord.count++;
      if (rateRecord.count > 80) {
        res.setHeader('Retry-After', Math.ceil((rateRecord.resetTime - now) / 1000));
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

    const trackingToken = req.params.trackingToken || (req.params as Record<string, string>).tokenOrCode;
    if (trackingToken) {
      const tokenRecord = trackingRateLimits.get(`tok:${trackingToken}`);
      if (tokenRecord && now < tokenRecord.resetTime) {
        tokenRecord.count++;
        if (tokenRecord.count > 60) {
          res.setHeader('Retry-After', Math.ceil((tokenRecord.resetTime - now) / 1000));
          return res.status(429).json({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded for this tracking link.',
            },
          });
        }
      } else {
        trackingRateLimits.set(`tok:${trackingToken}`, { count: 1, resetTime: now + 60000 });
      }
    }

    // Production lookup: strict trackingToken only via db.getTripByToken
    let trip: Trip | null = null;
    if (process.env.DEMO_MODE === 'true') {
      trip = db.getTripByToken(trackingToken) || db.getTripByTracking(trackingToken);
    } else {
      trip = db.getTripByToken(trackingToken);
    }

    if (!trip) {
      return res.status(404).json({
        error: {
          code: 'TRACKING_NOT_FOUND',
          message: 'No active shuttle or trip found with this tracking link.',
        },
      });
    }

    // Check token expiration (48-hour lifetime) and revocation
    const tokenExpiresAt = trip.tokenExpiresAt || trip.trackingTokenExpiresAt || (trip.createdAt + 48 * 60 * 60 * 1000);
    if (now > tokenExpiresAt || trip.tokenRevoked) {
      return res.status(410).json({
        error: {
          code: 'TRACKING_EXPIRED',
          message: 'This tracking link has expired or has been revoked.',
        },
      });
    }

    const driver = trip.assignedDriverId ? db.getDriver(trip.assignedDriverId) : null;
    const isCompletedOrCancelled = trip.status === 'COMPLETED' || trip.status === 'CANCELLED';

    // Calculate dynamic ETA using multi-signal engine
    let dynamicEtaResult: Partial<EtaCalculationResult> = {
      etaMinutes: trip.estimatedMinutes || 6,
      roadDistanceKm: trip.roadDistanceKm || 2.0,
      polyline: trip.routeGeometry || [],
      trafficLevel: 'Normal',
      trafficAssessmentBasis: 'Live Road Geometry',
    };

    if (driver && trip.dropoffCoords && !isCompletedOrCancelled) {
      try {
        dynamicEtaResult = await calculateDynamicEta({
          tripId: trip.id,
          driverLocation: driver.currentLocation,
          destinationCoords: (trip.status === 'AT_PICKUP' || trip.status === 'EN_ROUTE_PICKUP')
            ? trip.pickupCoords
            : trip.dropoffCoords,
        });
      } catch (err) {
        console.warn('Student tracking ETA calculation error:', err);
      }
    }

    // Calculate state
    let trackingState: StudentTrackingState = 'WAITING_FOR_DRIVER';
    const isCompleted = trip.status === 'COMPLETED';
    const isCancelled = trip.status === 'CANCELLED';
    const isAtPickup = trip.status === 'AT_PICKUP';
    const isInTransit = trip.status === 'IN_TRANSIT';
    const isEnRoute = trip.status === 'EN_ROUTE_PICKUP' || trip.status === 'ASSIGNED';

    const GPS_STALE_AFTER = Number(process.env.GPS_STALE_AFTER) || 30;
    const GPS_OFFLINE_AFTER = Number(process.env.GPS_OFFLINE_AFTER) || 120;

    const lastUpdatedSecondsAgo = Math.max(
      0,
      Math.round((Date.now() - (driver?.currentLocation.timestamp || trip.updatedAt)) / 1000)
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
    // Student sees: vehicle make/model and plate number, pickup, destination, ETA, and live location only during active trip.
    // NEVER expose driver phone, email, home, internal notes, student personal details, or database IDs.
    const response: PublicTrackingResponse = {
      status: trip.status,
      tripStatus: trip.status,
      trackingState,
      ...(process.env.DEMO_MODE === 'true' ? { trackingCode: trip.trackingCode } : {}),
      pickup: {
        address: trip.pickupAddress,
        lat: trip.pickupCoords.lat,
        lng: trip.pickupCoords.lng,
      },
      destination: {
        address: trip.dropoffAddress,
        lat: trip.dropoffCoords.lat,
        lng: trip.dropoffCoords.lng,
      },
      vehicle: driver
        ? {
            makeModel: driver.vehicleModel,
            plateNumber: driver.plateNumber,
            type: 'Shuttle Taxi',
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
      distanceKm: !isCompletedOrCancelled ? (dynamicEtaResult.roadDistanceKm ?? null) : 0,
      lastUpdated: driver?.currentLocation.timestamp || trip.updatedAt,
      lastUpdatedSecondsAgo,
      isStale,
      gpsFreshness,
    };

    res.json(response);
  };

  app.get('/api/public/tracking/:trackingToken', handlePublicTracking);

  // ==================== FLEET ANALYTICS ====================

  app.get('/api/analytics', requireAuth, (req, res) => {
    const targetComp = req.user!.companyId;
    const drivers = db.listDrivers(targetComp);
    const activeTrips = db.listActiveTrips(targetComp);
    const tripLogs = db.listTripLogs(targetComp);

    const completed = tripLogs.filter((t) => t.status === 'COMPLETED');
    const inTransit = activeTrips.filter((t) => t.status === 'IN_TRANSIT');
    const totalDistance = tripLogs.reduce((acc, t) => acc + t.distanceKm, 0);

    res.json({
      totalDrivers: drivers.length,
      availableDrivers: drivers.filter((d) => d.status === 'AVAILABLE').length,
      busyDrivers: drivers.filter((d) => d.status === 'IN_TRANSIT' || d.status === 'ASSIGNED' || d.status === 'EN_ROUTE_PICKUP').length,
      totalTripsToday: activeTrips.length + completed.length,
      completedTripsToday: completed.length,
      activeTrips: inTransit.length,
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
