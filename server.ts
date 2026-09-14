import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

interface DriverLocation {
  lat: number;
  lng: number;
  speed: number; // km/h
  heading: number; // degrees
  accuracy: number; // meters
  timestamp: number;
}

interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicleModel: string;
  plateNumber: string;
  networkCode: string;
  isLeadDriver: boolean;
  status: "available" | "busy" | "offline";
  currentLocation: DriverLocation;
  currentOrderId?: string;
  totalTrips: number;
  rating: number;
  activeTrip?: {
    id: string;
    startTime: number;
    startLocation: { lat: number; lng: number };
    breadcrumbs: DriverLocation[];
    distanceKm: number;
    maxSpeedKmH: number;
  };
}

interface Order {
  id: string;
  networkCode: string;
  customerName: string;
  customerPhone: string;
  pickupAddress: string;
  pickupCoords: { lat: number; lng: number };
  dropoffAddress: string;
  dropoffCoords: { lat: number; lng: number };
  packageInfo: string;
  assignedDriverId?: string;
  status: "pending" | "assigned" | "picked_up" | "in_transit" | "delivered" | "cancelled";
  createdAt: number;
  updatedAt: number;
  estimatedMinutes?: number;
  trackingCode: string;
}

interface TripLog {
  id: string;
  driverId: string;
  driverName: string;
  networkCode: string;
  startTime: number;
  endTime: number;
  startAddress: string;
  endAddress: string;
  distanceKm: number;
  durationMinutes: number;
  avgSpeedKmH: number;
  maxSpeedKmH: number;
  orderId?: string;
  path: [number, number][];
}

interface Network {
  code: string;
  name: string;
  ownerName: string;
  createdAt: number;
  leadDriverId?: string;
}

// In-memory data store seeded with authentic North Lebanon fleet data
const networks: Record<string, Network> = {
  "NORTH-77": {
    code: "NORTH-77",
    name: "Tripoli Express & North Courier",
    ownerName: "Tarek Haddad",
    createdAt: Date.now() - 86400000 * 5,
    leadDriverId: "drv-lead-1",
  },
  "CEDAR-24": {
    code: "CEDAR-24",
    name: "Batroun Coastal Delivery",
    ownerName: "Ziad Khoury",
    createdAt: Date.now() - 86400000 * 3,
    leadDriverId: "drv-batroun-1",
  },
};

const drivers: Record<string, Driver> = {
  "drv-lead-1": {
    id: "drv-lead-1",
    name: "Tarek Haddad (Lead Driver)",
    phone: "+961 70 123 456",
    vehicleModel: "Toyota Hilux Pickup",
    plateNumber: "T-48291",
    networkCode: "NORTH-77",
    isLeadDriver: true,
    status: "busy",
    currentLocation: {
      lat: 34.4367, // Tripoli Al-Mina
      lng: 35.8308,
      speed: 42,
      heading: 45,
      accuracy: 4,
      timestamp: Date.now(),
    },
    totalTrips: 142,
    rating: 4.9,
    currentOrderId: "ORD-TRIP-101",
  },
  "drv-2": {
    id: "drv-2",
    name: "Ahmad Masri",
    phone: "+961 71 889 012",
    vehicleModel: "Hyundai Elantra",
    plateNumber: "T-78932",
    networkCode: "NORTH-77",
    isLeadDriver: false,
    status: "busy",
    currentLocation: {
      lat: 34.4255, // Tripoli Boulevard
      lng: 35.8423,
      speed: 36,
      heading: 180,
      accuracy: 6,
      timestamp: Date.now(),
    },
    totalTrips: 98,
    rating: 4.8,
    currentOrderId: "ORD-TRIP-102",
  },
  "drv-3": {
    id: "drv-3",
    name: "Charbel Sarkis",
    phone: "+961 03 456 789",
    vehicleModel: "Renault Kangoo Express",
    plateNumber: "T-31209",
    networkCode: "NORTH-77",
    isLeadDriver: false,
    status: "available",
    currentLocation: {
      lat: 34.3982, // Zgharta entrance
      lng: 35.8927,
      speed: 0,
      heading: 90,
      accuracy: 5,
      timestamp: Date.now(),
    },
    totalTrips: 64,
    rating: 4.7,
  },
  "drv-4": {
    id: "drv-4",
    name: "Wissam Chehade",
    phone: "+961 76 543 210",
    vehicleModel: "Kia Cerato",
    plateNumber: "T-99214",
    networkCode: "NORTH-77",
    isLeadDriver: false,
    status: "busy",
    currentLocation: {
      lat: 34.3289, // Chekka Highway
      lng: 35.7312,
      speed: 78,
      heading: 215,
      accuracy: 3,
      timestamp: Date.now(),
    },
    totalTrips: 115,
    rating: 4.95,
  },
  "drv-batroun-1": {
    id: "drv-batroun-1",
    name: "Ziad Khoury (Lead Driver)",
    phone: "+961 70 998 877",
    vehicleModel: "Nissan Navara",
    plateNumber: "B-12845",
    networkCode: "CEDAR-24",
    isLeadDriver: true,
    status: "available",
    currentLocation: {
      lat: 34.2558, // Batroun Old Souks
      lng: 35.6601,
      speed: 25,
      heading: 10,
      accuracy: 5,
      timestamp: Date.now(),
    },
    totalTrips: 87,
    rating: 4.85,
  },
};

const orders: Record<string, Order> = {
  "ORD-TRIP-101": {
    id: "ORD-TRIP-101",
    networkCode: "NORTH-77",
    customerName: "Dr. Samer Baydoun",
    customerPhone: "+961 70 445 566",
    pickupAddress: "Tripoli Port Customs Freezone, El-Mina",
    pickupCoords: { lat: 34.4512, lng: 35.8194 },
    dropoffAddress: "Nini Hospital Medical Center, Dam & Farez, Tripoli",
    dropoffCoords: { lat: 34.4285, lng: 35.8361 },
    packageInfo: "Temperature-controlled medical supplies (Box #4)",
    assignedDriverId: "drv-lead-1",
    status: "in_transit",
    createdAt: Date.now() - 1800000,
    updatedAt: Date.now() - 300000,
    estimatedMinutes: 8,
    trackingCode: "TRK-9812",
  },
  "ORD-TRIP-102": {
    id: "ORD-TRIP-102",
    networkCode: "NORTH-77",
    customerName: "Layla Azar",
    customerPhone: "+961 71 332 211",
    pickupAddress: "Al Hallab 1881 Sweets, Tripoli Boulevard",
    pickupCoords: { lat: 34.4312, lng: 35.8398 },
    dropoffAddress: "Saydet Zgharta Square, Zgharta",
    dropoffCoords: { lat: 34.3995, lng: 35.8941 },
    packageInfo: "Pastry catering crates (Fragile)",
    assignedDriverId: "drv-2",
    status: "picked_up",
    createdAt: Date.now() - 2400000,
    updatedAt: Date.now() - 600000,
    estimatedMinutes: 16,
    trackingCode: "TRK-4421",
  },
  "ORD-TRIP-103": {
    id: "ORD-TRIP-103",
    networkCode: "NORTH-77",
    customerName: "Eng. Karim Sleiman",
    customerPhone: "+961 03 881 299",
    pickupAddress: "Chekka Industrial Plant Gate 2",
    pickupCoords: { lat: 34.3325, lng: 35.7289 },
    dropoffAddress: "University of Balamand Campus, Koura",
    dropoffCoords: { lat: 34.3672, lng: 35.7954 },
    packageInfo: "Architectural blueprints & survey drone kit",
    status: "pending",
    createdAt: Date.now() - 900000,
    updatedAt: Date.now() - 900000,
    estimatedMinutes: 22,
    trackingCode: "TRK-7710",
  },
};

const tripLogs: TripLog[] = [
  {
    id: "trip-901",
    driverId: "drv-lead-1",
    driverName: "Tarek Haddad",
    networkCode: "NORTH-77",
    startTime: Date.now() - 7200000,
    endTime: Date.now() - 4800000,
    startAddress: "Batroun Highway Entry",
    endAddress: "Tripoli Dam & Farez",
    distanceKm: 28.4,
    durationMinutes: 34,
    avgSpeedKmH: 50.1,
    maxSpeedKmH: 94.2,
    orderId: "ORD-PREV-89",
    path: [
      [34.2558, 35.6601],
      [34.2912, 35.6942],
      [34.3312, 35.7312],
      [34.3821, 35.7891],
      [34.4285, 35.8361],
    ],
  },
  {
    id: "trip-902",
    driverId: "drv-2",
    driverName: "Ahmad Masri",
    networkCode: "NORTH-77",
    startTime: Date.now() - 14400000,
    endTime: Date.now() - 12000000,
    startAddress: "Beddawi Refinery Intersection",
    endAddress: "Tripoli Port Al-Mina",
    distanceKm: 9.6,
    durationMinutes: 18,
    avgSpeedKmH: 32.0,
    maxSpeedKmH: 58.0,
    path: [
      [34.4601, 35.8654],
      [34.4489, 35.8451],
      [34.4367, 35.8308],
      [34.4512, 35.8194],
    ],
  },
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "North Lebanon Fleet Tracker", time: new Date().toISOString() });
  });

  // 1. Networks API
  app.get("/api/networks", (_req, res) => {
    res.json(Object.values(networks));
  });

  app.post("/api/networks", (req, res) => {
    const { name, ownerName } = req.body;
    if (!name || !ownerName) {
      return res.status(400).json({ error: "Network name and owner name required" });
    }
    // Generate clean 6-character code
    const prefix = name.replace(/[^a-zA-Z]/g, "").slice(0, 4).toUpperCase() || "FLEET";
    const num = Math.floor(10 + Math.random() * 89);
    const code = `${prefix}-${num}`;

    const newNetwork: Network = {
      code,
      name,
      ownerName,
      createdAt: Date.now(),
    };
    networks[code] = newNetwork;
    res.status(201).json(newNetwork);
  });

  app.get("/api/networks/:code", (req, res) => {
    const code = req.params.code.toUpperCase();
    const network = networks[code];
    if (!network) {
      return res.status(404).json({ error: "Network not found" });
    }
    const networkDrivers = Object.values(drivers).filter((d) => d.networkCode === code);
    const networkOrders = Object.values(orders).filter((o) => o.networkCode === code);
    res.json({
      network,
      drivers: networkDrivers,
      orders: networkOrders,
    });
  });

  // 2. Drivers API
  app.get("/api/drivers", (req, res) => {
    const { networkCode } = req.query;
    let list = Object.values(drivers);
    if (networkCode && typeof networkCode === "string") {
      list = list.filter((d) => d.networkCode === networkCode.toUpperCase());
    }
    res.json(list);
  });

  app.get("/api/drivers/:id", (req, res) => {
    const driver = drivers[req.params.id];
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }
    res.json(driver);
  });

  app.post("/api/drivers/join", (req, res) => {
    const { name, phone, vehicleModel, plateNumber, networkCode, isLeadDriver } = req.body;
    const code = (networkCode || "").toUpperCase();
    if (!name || !plateNumber || !code) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!networks[code]) {
      return res.status(404).json({ error: "Network code invalid" });
    }

    const id = `drv-${Date.now().toString(36)}`;
    // Default initial location in Tripoli Center
    const newDriver: Driver = {
      id,
      name,
      phone: phone || "+961 70 000 000",
      vehicleModel: vehicleModel || "Standard Fleet Vehicle",
      plateNumber,
      networkCode: code,
      isLeadDriver: Boolean(isLeadDriver),
      status: "available",
      currentLocation: {
        lat: 34.4367,
        lng: 35.8308,
        speed: 0,
        heading: 0,
        accuracy: 10,
        timestamp: Date.now(),
      },
      totalTrips: 0,
      rating: 5.0,
    };

    drivers[id] = newDriver;
    if (isLeadDriver) {
      networks[code].leadDriverId = id;
    }

    res.status(201).json(newDriver);
  });

  // 3. Driver Live Telemetry (GPS, Speedometer, Heading)
  app.post("/api/telemetry", (req, res) => {
    const { driverId, lat, lng, speed, heading, accuracy } = req.body;
    const driver = drivers[driverId];
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const loc: DriverLocation = {
      lat: Number(lat),
      lng: Number(lng),
      speed: Number(speed) || 0,
      heading: Number(heading) || 0,
      accuracy: Number(accuracy) || 5,
      timestamp: Date.now(),
    };

    driver.currentLocation = loc;

    // Track active trip if running
    if (driver.activeTrip) {
      driver.activeTrip.breadcrumbs.push(loc);
      if (loc.speed > driver.activeTrip.maxSpeedKmH) {
        driver.activeTrip.maxSpeedKmH = loc.speed;
      }
      // calculate delta distance
      const count = driver.activeTrip.breadcrumbs.length;
      if (count >= 2) {
        const prev = driver.activeTrip.breadcrumbs[count - 2];
        const dist = haversineDistanceKm(prev.lat, prev.lng, loc.lat, loc.lng);
        driver.activeTrip.distanceKm += dist;
      }
    }

    res.json({ success: true, driverId, location: loc });
  });

  // Start / Stop Trip
  app.post("/api/drivers/:id/trip/start", (req, res) => {
    const driver = drivers[req.params.id];
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    driver.activeTrip = {
      id: `trip-${Date.now()}`,
      startTime: Date.now(),
      startLocation: { lat: driver.currentLocation.lat, lng: driver.currentLocation.lng },
      breadcrumbs: [driver.currentLocation],
      distanceKm: 0,
      maxSpeedKmH: driver.currentLocation.speed,
    };

    res.json({ success: true, activeTrip: driver.activeTrip });
  });

  app.post("/api/drivers/:id/trip/stop", (req, res) => {
    const driver = drivers[req.params.id];
    if (!driver || !driver.activeTrip) {
      return res.status(400).json({ error: "No active trip to end" });
    }

    const trip = driver.activeTrip;
    const durationMinutes = Math.max(1, Math.round((Date.now() - trip.startTime) / 60000));
    const avgSpeed = durationMinutes > 0 ? (trip.distanceKm / (durationMinutes / 60)) : 0;

    const completedTrip: TripLog = {
      id: trip.id,
      driverId: driver.id,
      driverName: driver.name,
      networkCode: driver.networkCode,
      startTime: trip.startTime,
      endTime: Date.now(),
      startAddress: `GPS (${trip.startLocation.lat.toFixed(4)}, ${trip.startLocation.lng.toFixed(4)})`,
      endAddress: `GPS (${driver.currentLocation.lat.toFixed(4)}, ${driver.currentLocation.lng.toFixed(4)})`,
      distanceKm: Math.round(trip.distanceKm * 10) / 10,
      durationMinutes,
      avgSpeedKmH: Math.round(avgSpeed * 10) / 10,
      maxSpeedKmH: Math.round(trip.maxSpeedKmH * 10) / 10,
      orderId: driver.currentOrderId,
      path: trip.breadcrumbs.map((b) => [b.lat, b.lng]),
    };

    tripLogs.unshift(completedTrip);
    driver.totalTrips += 1;
    delete driver.activeTrip;

    res.json({ success: true, completedTrip });
  });

  // 4. Orders & Lead Driver Dispatch API
  app.get("/api/orders", (req, res) => {
    const { networkCode } = req.query;
    let list = Object.values(orders);
    if (networkCode && typeof networkCode === "string") {
      list = list.filter((o) => o.networkCode === networkCode.toUpperCase());
    }
    res.json(list);
  });

  app.post("/api/orders", (req, res) => {
    const {
      networkCode,
      customerName,
      customerPhone,
      pickupAddress,
      pickupCoords,
      dropoffAddress,
      dropoffCoords,
      packageInfo,
      assignedDriverId,
    } = req.body;

    if (!networkCode || !customerName || !pickupAddress || !dropoffAddress) {
      return res.status(400).json({ error: "Missing required order information" });
    }

    const id = `ORD-${Date.now().toString().slice(-6)}`;
    const trackingCode = `TRK-${Math.floor(1000 + Math.random() * 9000)}`;

    const newOrder: Order = {
      id,
      networkCode: networkCode.toUpperCase(),
      customerName,
      customerPhone: customerPhone || "+961 70 000 000",
      pickupAddress,
      pickupCoords: pickupCoords || { lat: 34.4367, lng: 35.8308 },
      dropoffAddress,
      dropoffCoords: dropoffCoords || { lat: 34.4255, lng: 35.8423 },
      packageInfo: packageInfo || "General Freight / Delivery",
      assignedDriverId,
      status: assignedDriverId ? "assigned" : "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      estimatedMinutes: 15,
      trackingCode,
    };

    orders[id] = newOrder;

    if (assignedDriverId && drivers[assignedDriverId]) {
      drivers[assignedDriverId].status = "busy";
      drivers[assignedDriverId].currentOrderId = id;
    }

    res.status(201).json(newOrder);
  });

  // Lead Driver assigns order to a specific driver
  app.patch("/api/orders/:id/assign", (req, res) => {
    const { driverId } = req.body;
    const order = orders[req.params.id];
    if (!order) return res.status(404).json({ error: "Order not found" });

    if (driverId) {
      const driver = drivers[driverId];
      if (!driver) return res.status(404).json({ error: "Driver not found" });
      order.assignedDriverId = driverId;
      order.status = "assigned";
      order.updatedAt = Date.now();
      driver.status = "busy";
      driver.currentOrderId = order.id;
    } else {
      // Unassign
      if (order.assignedDriverId && drivers[order.assignedDriverId]) {
        drivers[order.assignedDriverId].status = "available";
        delete drivers[order.assignedDriverId].currentOrderId;
      }
      order.assignedDriverId = undefined;
      order.status = "pending";
    }

    res.json(order);
  });

  // Driver updates order status (picked_up, in_transit, delivered)
  app.patch("/api/orders/:id/status", (req, res) => {
    const { status } = req.body;
    const order = orders[req.params.id];
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.status = status;
    order.updatedAt = Date.now();

    if (status === "delivered" && order.assignedDriverId) {
      const driver = drivers[order.assignedDriverId];
      if (driver) {
        driver.status = "available";
        delete driver.currentOrderId;
        driver.totalTrips += 1;
      }
    }

    res.json(order);
  });

  // 5. Customer Live Tracking API
  app.get("/api/orders/track/:trackingCode", (req, res) => {
    const code = req.params.trackingCode.toUpperCase();
    const order = Object.values(orders).find(
      (o) => o.trackingCode.toUpperCase() === code || o.id.toUpperCase() === code
    );

    if (!order) {
      return res.status(404).json({ error: "No active delivery found with this tracking ID" });
    }

    let driver: Driver | undefined = undefined;
    if (order.assignedDriverId) {
      driver = drivers[order.assignedDriverId];
    }

    // Compute live ETA based on distance and driver's speedometer speed
    let liveEtaMinutes = 15;
    let distanceToDestinationKm = 5.0;

    if (driver && order.dropoffCoords) {
      distanceToDestinationKm = haversineDistanceKm(
        driver.currentLocation.lat,
        driver.currentLocation.lng,
        order.dropoffCoords.lat,
        order.dropoffCoords.lng
      );

      // Speed in km/h from phone speedometer (default to average 35 km/h in North Lebanon if stopped or slow)
      const currentSpeed = driver.currentLocation.speed > 5 ? driver.currentLocation.speed : 35;
      
      // Add traffic buffer factor (1.25 for coastal road or urban souk traffic)
      const trafficFactor = 1.25;
      const rawHours = distanceToDestinationKm / currentSpeed;
      liveEtaMinutes = Math.max(2, Math.round(rawHours * 60 * trafficFactor));
    }

    res.json({
      order,
      driver: driver
        ? {
            id: driver.id,
            name: driver.name,
            phone: driver.phone,
            vehicleModel: driver.vehicleModel,
            plateNumber: driver.plateNumber,
            currentLocation: driver.currentLocation,
            rating: driver.rating,
          }
        : null,
      liveEtaMinutes,
      distanceKm: Math.round(distanceToDestinationKm * 10) / 10,
    });
  });

  // 6. Trip History
  app.get("/api/trips", (req, res) => {
    const { driverId, networkCode } = req.query;
    let list = tripLogs;
    if (networkCode && typeof networkCode === "string") {
      list = list.filter((t) => t.networkCode === networkCode.toUpperCase());
    }
    if (driverId && typeof driverId === "string") {
      list = list.filter((t) => t.driverId === driverId);
    }
    res.json(list);
  });

  // Helper distance function (Haversine in km)
  function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Vite middleware for development vs static serve for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`North Lebanon Fleet Tracker server running on http://localhost:${PORT}`);
  });
}

startServer();
