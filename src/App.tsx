import React, { useState, useEffect, useCallback } from 'react';
import {
  Car,
  Navigation,
  MapPin,
  LayoutDashboard,
  Route,
  Building2,
  ChevronDown,
  Wifi,
  WifiOff,
  UserCheck,
} from 'lucide-react';
import { Driver, Order, Network, TripLog } from './types';
import { DriverPhoneView } from './components/DriverPhoneView';
import { LeadDriverDispatchView } from './components/LeadDriverDispatchView';
import { StudentTrackingView } from './components/StudentTrackingView';
import { CompanyDashboardView } from './components/CompanyDashboardView';
import { NetworkSwitcherModal } from './components/NetworkSwitcherModal';
import { TripHistoryModal } from './components/TripHistoryModal';
import { MapComponent } from './components/MapComponent';
import { getSocket, joinCompanyRoom, joinDriverRoom } from './services/socket';
import { api } from './services/api';

export default function App() {
  // Navigation tabs: Driver Phone, Lead Dispatcher, Customer Live Tracking, Fleet Dashboard
  const [activeTab, setActiveTab] = useState<'driver' | 'lead' | 'customer' | 'company'>('driver');
  const [initialTrackingCode, setInitialTrackingCode] = useState<string>('TRK-8821');

  // Network & Entities State
  const [networks, setNetworks] = useState<Network[]>([]);
  const [currentNetwork, setCurrentNetwork] = useState<Network>({
    id: 'comp-jbeil-01',
    code: 'JBEIL-CAMPUS',
    name: 'Byblos Student Fleet & Shuttle',
    ownerName: 'Charbel Abi Nader',
    ownerEmail: 'charbel@byblosfleet.lb',
    createdAt: Date.now(),
    settings: {
      adaptiveGpsMovingSec: 3,
      adaptiveGpsStoppedSec: 20,
      speedLimitKmH: 60,
      enablePublicDriverPhone: false,
    },
  });

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [currentDriverId, setCurrentDriverId] = useState<string>('drv-jbeil-1');
  const [orders, setOrders] = useState<Order[]>([]);
  const [tripLogs, setTripLogs] = useState<TripLog[]>([]);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);

  // Modals
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showTripHistoryModal, setShowTripHistoryModal] = useState(false);

  // Map inspection state for Split View on Desktop
  const [mapSelectedDriver, setMapSelectedDriver] = useState<Driver | null>(null);

  // 1. URL Query Parameter Bootstrap
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam === 'driver' || tabParam === 'lead' || tabParam === 'customer' || tabParam === 'company') {
      setActiveTab(tabParam);
    }
    const trackParam = params.get('track');
    if (trackParam) {
      setInitialTrackingCode(trackParam);
      setActiveTab('customer');
    }
    const inviteParam = params.get('invite');
    if (inviteParam) {
      setShowNetworkModal(true);
    }
  }, []);

  // 2. Fetch all initial data
  const fetchAllData = useCallback(async () => {
    try {
      const [netRes, drvRes, ordRes, tripRes] = await Promise.all([
        fetch('/api/networks').catch(() => null),
        fetch(`/api/drivers?networkCode=${currentNetwork.code}`).catch(() => null),
        fetch(`/api/orders?networkCode=${currentNetwork.code}`).catch(() => null),
        fetch(`/api/trips?networkCode=${currentNetwork.code}`).catch(() => null),
      ]);

      if (netRes && netRes.ok) {
        const netData = await netRes.json();
        setNetworks(netData);
        const match = netData.find((n: Network) => n.code === currentNetwork.code);
        if (match) setCurrentNetwork(match);
      }

      if (drvRes && drvRes.ok) {
        const drvData = await drvRes.json();
        setDrivers(drvData);
        if (drvData.length > 0 && !drvData.find((d: Driver) => d.id === currentDriverId)) {
          setCurrentDriverId(drvData[0].id);
        }
      }

      if (ordRes && ordRes.ok) {
        const ordData = await ordRes.json();
        setOrders(ordData);
      }

      if (tripRes && tripRes.ok) {
        const tripData = await tripRes.json();
        setTripLogs(tripData);
      }
    } catch (err) {
      console.warn('Sync error:', err);
    }
  }, [currentNetwork.code, currentDriverId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // 3. Socket.IO Real-time Connection & Event Listeners
  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setSocketConnected(true);
      joinCompanyRoom(currentNetwork.id || currentNetwork.code);
      if (currentDriverId) {
        joinDriverRoom(currentDriverId);
      }
    };

    const onDisconnect = () => {
      setSocketConnected(false);
    };

    if (socket.connected) {
      onConnect();
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    // Live driver location update broadcast
    const onDriverLocation = (data: { driverId: string; location: Driver['currentLocation']; status: Driver['status'] }) => {
      setDrivers((prev) =>
        prev.map((d) => (d.id === data.driverId ? { ...d, currentLocation: data.location, status: data.status } : d))
      );
    };

    // Driver joined event
    const onDriverJoined = (newDriver: Driver) => {
      setDrivers((prev) => {
        if (prev.some((d) => d.id === newDriver.id)) return prev;
        return [...prev, newDriver];
      });
    };

    // Order events
    const onTripCreated = (newTrip: Order) => {
      setOrders((prev) => {
        if (prev.some((o) => o.id === newTrip.id)) return prev;
        return [newTrip, ...prev];
      });
    };

    const onTripAssigned = (data: { order?: Order; trip?: Order; driverId: string }) => {
      const trip = data.trip || data.order;
      if (!trip) return;
      setOrders((prev) =>
        prev.map((o) => (o.id === trip.id ? trip : o))
      );
    };

    const onTripStatusChanged = (data: { orderId?: string; tripId?: string; status: Order['status'] }) => {
      const targetId = data.tripId || data.orderId;
      setOrders((prev) =>
        prev.map((o) => (o.id === targetId ? { ...o, status: data.status } : o))
      );
    };

    const onTripUpdated = (updatedTrip: Order) => {
      setOrders((prev) =>
        prev.some((o) => o.id === updatedTrip.id)
          ? prev.map((o) => (o.id === updatedTrip.id ? updatedTrip : o))
          : [updatedTrip, ...prev]
      );
    };

    socket.on('driver:location', onDriverLocation);
    socket.on('driver:joined', onDriverJoined);
    socket.on('trip:created', onTripCreated);
    socket.on('order:created', onTripCreated);
    socket.on('trip:assigned', onTripAssigned);
    socket.on('order:assigned', onTripAssigned);
    socket.on('trip:status_changed', onTripStatusChanged);
    socket.on('order:status_changed', onTripStatusChanged);
    socket.on('trip:updated', onTripUpdated);
    socket.on('order:updated', onTripUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('driver:location', onDriverLocation);
      socket.off('driver:joined', onDriverJoined);
      socket.off('trip:created', onTripCreated);
      socket.off('order:created', onTripCreated);
      socket.off('trip:assigned', onTripAssigned);
      socket.off('order:assigned', onTripAssigned);
      socket.off('trip:status_changed', onTripStatusChanged);
      socket.off('order:status_changed', onTripStatusChanged);
      socket.off('trip:updated', onTripUpdated);
      socket.off('order:updated', onTripUpdated);
    };
  }, [currentNetwork.id, currentNetwork.code, currentDriverId]);

  // Periodic fallback polling every 6 seconds
  useEffect(() => {
    if (socketConnected) return;

    const interval = setInterval(() => {
      fetch(`/api/drivers?networkCode=${currentNetwork.code}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setDrivers(data);
        })
        .catch(() => {});

      fetch(`/api/orders?networkCode=${currentNetwork.code}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setOrders(data);
        })
        .catch(() => {});
    }, 6000);

    return () => clearInterval(interval);
  }, [currentNetwork.code, socketConnected]);

  // Current Driver Object
  const currentDriver =
    drivers.find((d) => d.id === currentDriverId) ||
    drivers[0] || {
      id: 'drv-jbeil-1',
      name: 'Charbel Abi Nader',
      phone: '+961 70 112 233',
      vehicleModel: 'Toyota HiAce Minibus',
      plateNumber: 'J-48192',
      networkCode: currentNetwork.code,
      isLeadDriver: true,
      status: 'AVAILABLE',
      currentLocation: {
        lat: 34.1238,
        lng: 35.6698,
        speed: 0,
        heading: 0,
        accuracy: 5,
        timestamp: Date.now(),
      },
      totalTrips: 184,
      rating: 4.95,
    };

  // Active order for current driver
  const activeOrderForCurrentDriver = orders.find(
    (o) =>
      o.assignedDriverId === currentDriver.id &&
      o.status.toUpperCase() !== 'DELIVERED' &&
      o.status.toUpperCase() !== 'CANCELLED'
  );

  // Location handler from Driver Phone Cockpit
  const handleUpdateLocation = async (loc: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
    batteryLevel?: number;
    networkStatus?: 'wifi' | '4g' | '3g' | 'offline';
    isSimulated?: boolean;
  }) => {
    // 1. Optimistic local update
    setDrivers((prev) =>
      prev.map((d) =>
        d.id === currentDriver.id
          ? {
              ...d,
              currentLocation: {
                ...loc,
                timestamp: Date.now(),
              },
            }
          : d
      )
    );

    // 2. Post telemetry to server (handles offline queueing if offline)
    try {
      await api.updateLocation({
        driverId: currentDriver.id,
        ...loc,
      });
    } catch (err) {
      console.warn('Telemetry post failed', err);
    }
  };

  const handleStartTrip = async () => {
    try {
      const res = await fetch(`/api/drivers/${currentDriver.id}/trip/start`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDrivers((prev) =>
          prev.map((d) => (d.id === currentDriver.id ? { ...d, activeTrip: data.activeTrip } : d))
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEndTrip = async () => {
    try {
      const res = await fetch(`/api/drivers/${currentDriver.id}/trip/stop`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.completedTrip) {
          setTripLogs((prev) => [data.completedTrip, ...prev]);
        }
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateOrder = async (orderData: Partial<Order>) => {
    try {
      const newOrder = await api.createOrder({
        networkCode: currentNetwork.code,
        ...orderData,
      });
      setOrders((prev) => [newOrder, ...prev]);
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignOrder = async (orderId: string, driverId: string) => {
    try {
      await api.assignOrder(orderId, driverId);
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      await api.updateOrderStatus(orderId, status);
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleDriverStatus = (status: Driver['status']) => {
    setDrivers((prev) =>
      prev.map((d) => (d.id === currentDriver.id ? { ...d, status } : d))
    );
  };

  const handleCreateNetwork = async (name: string, ownerName: string) => {
    try {
      const res = await fetch('/api/networks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, ownerName }),
      });
      if (res.ok) {
        const newNet = await res.json();
        setNetworks((prev) => [...prev, newNet]);
        setCurrentNetwork(newNet);
        setShowNetworkModal(false);
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoinNetwork = async (data: {
    networkCode: string;
    driverName: string;
    phone: string;
    vehicleModel: string;
    plateNumber: string;
    isLeadDriver: boolean;
  }) => {
    try {
      const newDriver = await api.joinFleet({
        networkCode: data.networkCode,
        name: data.driverName,
        phone: data.phone,
        vehicleModel: data.vehicleModel,
        plateNumber: data.plateNumber,
        isLeadDriver: data.isLeadDriver,
      });
      setDrivers((prev) => [...prev, newDriver]);
      setCurrentDriverId(newDriver.id);
      const netMatch = networks.find((n) => n.code === data.networkCode);
      if (netMatch) setCurrentNetwork(netMatch);
      setShowNetworkModal(false);
      fetchAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSetLeadDriver = (driverId: string) => {
    setDrivers((prev) =>
      prev.map((d) => ({
        ...d,
        isLeadDriver: d.id === driverId,
      }))
    );
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col font-sans selection:bg-[#3b82f6]/30">
      {/* Top Application Bar - Slim & Clean 52px */}
      <header className="sticky top-0 z-40 bg-[#0a0a0f]/95 backdrop-blur-md border-b border-white/[0.06] h-[52px] px-4 sm:px-6">
        <div className="max-w-7xl h-full mx-auto flex items-center justify-between gap-4">
          {/* Logo Wordmark & Network Name */}
          <div className="flex flex-col justify-center">
            <span className="text-white font-medium text-base tracking-tight leading-none">ONTime</span>
            <button
              id="btn-header-network-switcher"
              onClick={() => setShowNetworkModal(true)}
              className="text-[11px] text-[#94a3b8] hover:text-white transition-colors flex items-center gap-1 mt-1 leading-none text-left"
            >
              <span>{currentNetwork.name}</span>
              <span className="font-mono text-[#4a5568]">({currentNetwork.code})</span>
            </button>
          </div>

          {/* Right Side: Socket status, Driver dropdown, Plain text actions */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs">
            {/* Minimal socket status: small dot with text, no badge box */}
            <div className="flex items-center gap-1.5">
              {socketConnected ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#22c55e]"></span>
                </span>
              ) : (
                <span className="w-2 h-2 rounded-full bg-[#4a5568]" />
              )}
              <span className={socketConnected ? 'text-[#94a3b8]' : 'text-[#4a5568]'}>
                {socketConnected ? 'Live' : 'Offline'}
              </span>
            </div>

            {/* Driver selector: clean minimal dropdown, no border box */}
            {drivers.length > 0 && (
              <div className="hidden sm:flex items-center gap-1">
                <select
                  value={currentDriverId}
                  onChange={(e) => setCurrentDriverId(e.target.value)}
                  className="bg-transparent text-xs text-[#94a3b8] hover:text-white outline-none cursor-pointer pr-1 transition-colors"
                >
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id} className="bg-[#13131a] text-white">
                      {d.name} {d.isLeadDriver ? '(Lead)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Trip Logs: plain text button with subtle hover underline */}
            <button
              id="btn-open-trip-logs"
              onClick={() => setShowTripHistoryModal(true)}
              className="text-[#94a3b8] hover:text-white hover:underline transition-colors hidden sm:inline"
            >
              Trip Logs
            </button>

            {/* Join / Switch: plain text button with subtle hover underline */}
            <button
              id="btn-header-network-code"
              onClick={() => setShowNetworkModal(true)}
              className="text-[#94a3b8] hover:text-white hover:underline transition-colors"
            >
              Switch Fleet
            </button>
          </div>
        </div>
      </header>

      {/* Tabs: Flush below header with bottom border separating from content */}
      <div className="border-b border-white/[0.06] bg-[#0a0a0f] sticky top-[52px] z-30 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center gap-8">
          {[
            { id: 'driver', label: 'Driver Phone', icon: Car },
            { id: 'lead', label: 'Dispatcher', icon: Navigation },
            { id: 'customer', label: 'Student Tracking', icon: MapPin },
            { id: 'company', label: 'Fleet Overview', icon: LayoutDashboard },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id as 'driver' | 'lead' | 'customer' | 'company')}
                className={`py-3 text-xs font-medium transition-colors relative flex items-center gap-1.5 ${
                  isActive ? 'text-white' : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#3b82f6]' : 'text-[#94a3b8]'}`} />
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#3b82f6]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 flex flex-col">
        {/* Tab 1: Driver Mobile Cockpit */}
        {activeTab === 'driver' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-6">
              <DriverPhoneView
                currentDriver={currentDriver}
                activeOrder={activeOrderForCurrentDriver}
                onUpdateLocation={handleUpdateLocation}
                onStartTrip={handleStartTrip}
                onEndTrip={handleEndTrip}
                onUpdateOrderStatus={handleUpdateOrderStatus}
                onToggleStatus={handleToggleDriverStatus}
              />
            </div>

            {/* Edge-to-edge side panel map (no rounded corners) */}
            <div className="hidden lg:block lg:col-span-6 h-[calc(100vh-140px)] sticky top-[116px] border border-white/[0.06]">
              <MapComponent
                drivers={[currentDriver]}
                selectedDriverId={currentDriver.id}
                activeOrder={activeOrderForCurrentDriver}
                orders={activeOrderForCurrentDriver ? [activeOrderForCurrentDriver] : []}
                height="100%"
                followDriver={true}
                className="w-full h-full"
              />
            </div>
          </div>
        )}

        {/* Tab 2: Lead Driver Dispatch Console */}
        {activeTab === 'lead' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7">
              <LeadDriverDispatchView
                currentDriver={currentDriver}
                drivers={drivers}
                orders={orders}
                onCreateOrder={handleCreateOrder}
                onAssignOrder={handleAssignOrder}
                onSelectDriverForMap={(drv) => setMapSelectedDriver(drv)}
              />
            </div>

            {/* Edge-to-edge side panel map (no rounded corners) */}
            <div className="hidden lg:block lg:col-span-5 h-[calc(100vh-140px)] sticky top-[116px] border border-white/[0.06]">
              <MapComponent
                drivers={drivers}
                selectedDriverId={mapSelectedDriver?.id || currentDriver.id}
                orders={orders}
                height="100%"
                className="w-full h-full"
              />
            </div>
          </div>
        )}

        {/* Tab 3: Student Live Tracking View */}
        {activeTab === 'customer' && (
          <StudentTrackingView
            initialTrackingCode={initialTrackingCode}
          />
        )}

        {/* Tab 4: Fleet Company Central Dashboard */}
        {activeTab === 'company' && (
          <CompanyDashboardView
            network={currentNetwork}
            drivers={drivers}
            orders={orders}
            tripLogs={tripLogs}
            onAddDriver={(driverData) => {
              handleJoinNetwork({
                networkCode: currentNetwork.code,
                driverName: driverData.name || 'New Driver',
                phone: driverData.phone || '+961 70 000 000',
                vehicleModel: driverData.vehicleModel || 'Standard Fleet Car',
                plateNumber: driverData.plateNumber || 'T-00000',
                isLeadDriver: Boolean(driverData.isLeadDriver),
              });
            }}
            onSetLeadDriver={handleSetLeadDriver}
          />
        )}
      </main>

      {/* Persistent Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0f]/95 backdrop-blur-md border-t border-white/[0.06] px-4 py-2 flex items-center justify-around">
        {[
          { id: 'driver', label: 'Driver', icon: Car },
          { id: 'lead', label: 'Dispatch', icon: Navigation },
          { id: 'customer', label: 'Student', icon: MapPin },
          { id: 'company', label: 'Fleet', icon: LayoutDashboard },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as 'driver' | 'lead' | 'customer' | 'company')}
              className={`flex flex-col items-center gap-1 text-[11px] font-medium transition-colors ${
                isActive ? 'text-white' : 'text-[#94a3b8]'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-[#3b82f6]' : 'text-[#94a3b8]'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Modals */}
      {showNetworkModal && (
        <NetworkSwitcherModal
          currentNetwork={currentNetwork}
          availableNetworks={networks}
          drivers={drivers}
          currentDriver={currentDriver}
          onSelectNetwork={(code) => {
            const match = networks.find((n) => n.code === code);
            if (match) {
              setCurrentNetwork(match);
              setShowNetworkModal(false);
            }
          }}
          onCreateNetwork={handleCreateNetwork}
          onJoinNetwork={handleJoinNetwork}
          onSelectDriver={(id) => {
            setCurrentDriverId(id);
            setShowNetworkModal(false);
          }}
          onClose={() => setShowNetworkModal(false)}
        />
      )}

      {showTripHistoryModal && (
        <TripHistoryModal
          tripLogs={tripLogs}
          onClose={() => setShowTripHistoryModal(false)}
        />
      )}
    </div>
  );
}
