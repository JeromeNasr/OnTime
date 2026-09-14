import React, { useState, useEffect, useCallback } from 'react';
import {
  Car,
  Navigation,
  MapPin,
  LayoutDashboard,
  Route,
  Building2,
  Radio,
  Clock,
  Sparkles,
  PhoneCall,
  Menu,
  ChevronDown,
} from 'lucide-react';
import { Driver, Order, Network, TripLog } from './types';
import { DriverPhoneView } from './components/DriverPhoneView';
import { LeadDriverDispatchView } from './components/LeadDriverDispatchView';
import { CustomerTrackingView } from './components/CustomerTrackingView';
import { CompanyDashboardView } from './components/CompanyDashboardView';
import { NetworkSwitcherModal } from './components/NetworkSwitcherModal';
import { TripHistoryModal } from './components/TripHistoryModal';
import { MapComponent } from './components/MapComponent';

export default function App() {
  // Navigation tabs: Driver Phone, Lead Dispatcher, Customer Live Tracking, Fleet Dashboard
  const [activeTab, setActiveTab] = useState<'driver' | 'lead' | 'customer' | 'company'>('driver');

  // Network & Entities State
  const [networks, setNetworks] = useState<Network[]>([]);
  const [currentNetwork, setCurrentNetwork] = useState<Network>({
    code: 'NORTH-77',
    name: 'Tripoli Express & North Courier',
    ownerName: 'Tarek Haddad',
    createdAt: Date.now(),
  });

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [currentDriverId, setCurrentDriverId] = useState<string>('drv-lead-1');
  const [orders, setOrders] = useState<Order[]>([]);
  const [tripLogs, setTripLogs] = useState<TripLog[]>([]);

  // Modals
  const [showNetworkModal, setShowNetworkModal] = useState(false);
  const [showTripHistoryModal, setShowTripHistoryModal] = useState(false);

  // Map inspection state for Split View on Desktop
  const [mapSelectedDriver, setMapSelectedDriver] = useState<Driver | null>(null);

  // 1. Initial Load from Server
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

  // Periodic Telemetry Sync every 3.5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/drivers?networkCode=${currentNetwork.code}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setDrivers(data);
          }
        })
        .catch(() => {});

      fetch(`/api/orders?networkCode=${currentNetwork.code}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setOrders(data);
          }
        })
        .catch(() => {});
    }, 3500);

    return () => clearInterval(interval);
  }, [currentNetwork.code]);

  // Current Driver Object
  const currentDriver = drivers.find((d) => d.id === currentDriverId) || drivers[0] || {
    id: 'drv-lead-1',
    name: 'Tarek Haddad',
    phone: '+961 70 123 456',
    vehicleModel: 'Toyota Hilux Pickup',
    plateNumber: 'T-48291',
    networkCode: currentNetwork.code,
    isLeadDriver: true,
    status: 'available',
    currentLocation: {
      lat: 34.4367,
      lng: 35.8308,
      speed: 0,
      heading: 0,
      accuracy: 5,
      timestamp: Date.now(),
    },
    totalTrips: 142,
    rating: 4.9,
  };

  // Active order for current driver
  const activeOrderForCurrentDriver = orders.find(
    (o) => o.assignedDriverId === currentDriver.id && o.status !== 'delivered' && o.status !== 'cancelled'
  );

  // Handlers
  const handleUpdateLocation = async (loc: {
    lat: number;
    lng: number;
    speed: number;
    heading: number;
    accuracy: number;
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

    // 2. Post telemetry to server for other drivers & customers
    try {
      await fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driverId: currentDriver.id,
          ...loc,
        }),
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
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          networkCode: currentNetwork.code,
          ...orderData,
        }),
      });
      if (res.ok) {
        const newOrder = await res.json();
        setOrders((prev) => [newOrder, ...prev]);
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignOrder = async (orderId: string, driverId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/assign`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId }),
      });
      if (res.ok) {
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateOrderStatus = async (orderId: string, status: Order['status']) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        fetchAllData();
      }
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
      const res = await fetch('/api/drivers/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.driverName,
          phone: data.phone,
          vehicleModel: data.vehicleModel,
          plateNumber: data.plateNumber,
          networkCode: data.networkCode,
          isLeadDriver: data.isLeadDriver,
        }),
      });
      if (res.ok) {
        const newDriver = await res.json();
        setDrivers((prev) => [...prev, newDriver]);
        setCurrentDriverId(newDriver.id);
        const netMatch = networks.find((n) => n.code === data.networkCode);
        if (netMatch) setCurrentNetwork(netMatch);
        setShowNetworkModal(false);
        fetchAllData();
      }
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
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950">
      {/* Top Application Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-800 px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          {/* Logo & Network Selector */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-emerald-500/20">
              <Navigation className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm tracking-tight text-slate-100">
                  North Lebanon Fleet
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-1.5 py-0.2 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  OSM GPS
                </span>
              </div>
              <button
                id="btn-header-network-switcher"
                onClick={() => setShowNetworkModal(true)}
                className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors font-medium"
              >
                <span>Net: {currentNetwork.name}</span>
                <span className="font-mono bg-amber-950/60 border border-amber-800/80 text-[10px] px-1 rounded font-bold">
                  {currentNetwork.code}
                </span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Quick Actions & Trip Logs */}
          <div className="flex items-center gap-2">
            <button
              id="btn-open-trip-logs"
              onClick={() => setShowTripHistoryModal(true)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shadow"
            >
              <Route className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">Trip Logs</span>
              <span className="bg-slate-900 text-slate-400 px-1.5 py-0.2 rounded-full text-[10px] font-mono">
                {tripLogs.length}
              </span>
            </button>

            <button
              id="btn-header-network-code"
              onClick={() => setShowNetworkModal(true)}
              className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Join / Switch</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main View Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 flex flex-col">
        {/* Android / Desktop Mode Selector Tabs */}
        <div className="flex items-center justify-between mb-4 bg-slate-900/80 border border-slate-800 p-1 rounded-2xl">
          <div className="grid grid-cols-4 w-full gap-1 text-xs font-bold">
            <button
              id="tab-driver-phone"
              onClick={() => setActiveTab('driver')}
              className={`py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'driver'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Car className="w-4 h-4" />
              <span className="hidden sm:inline">Driver Phone</span>
              <span className="sm:hidden">Driver</span>
            </button>

            <button
              id="tab-lead-dispatch"
              onClick={() => setActiveTab('lead')}
              className={`py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'lead'
                  ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Navigation className="w-4 h-4" />
              <span className="hidden sm:inline">Main Dispatcher</span>
              <span className="sm:hidden">Dispatch</span>
            </button>

            <button
              id="tab-customer-tracking"
              onClick={() => setActiveTab('customer')}
              className={`py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'customer'
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span className="hidden sm:inline">Customer ETA</span>
              <span className="sm:hidden">Track</span>
            </button>

            <button
              id="tab-company-dashboard"
              onClick={() => setActiveTab('company')}
              className={`py-2.5 px-2 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'company'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Fleet Dashboard</span>
              <span className="sm:hidden">Fleet</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Driver Mobile Cockpit */}
        {activeTab === 'driver' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
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

            {/* Accompanying OpenStreetMap Live Radar for Driver */}
            <div className="hidden lg:block lg:col-span-6 h-[640px] rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative sticky top-20">
              <MapComponent
                drivers={[currentDriver]}
                selectedDriverId={currentDriver.id}
                activeOrder={activeOrderForCurrentDriver}
                orders={activeOrderForCurrentDriver ? [activeOrderForCurrentDriver] : []}
                height="100%"
                followDriver={true}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Lead Driver Dispatch Console */}
        {activeTab === 'lead' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
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

            <div className="hidden lg:block lg:col-span-5 h-[640px] rounded-3xl overflow-hidden border border-slate-800 shadow-2xl relative sticky top-20">
              <MapComponent
                drivers={drivers}
                selectedDriverId={mapSelectedDriver?.id || currentDriver.id}
                orders={orders}
                height="100%"
              />
            </div>
          </div>
        )}

        {/* Tab 3: Customer Live Tracking View */}
        {activeTab === 'customer' && (
          <CustomerTrackingView orders={orders} drivers={drivers} />
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

      {/* Persistent Android Mobile Navigation Bar for ergonomic thumb reach */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 px-3 py-2 flex items-center justify-around">
        <button
          onClick={() => setActiveTab('driver')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'driver' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <Car className="w-5 h-5" />
          <span>Driver</span>
        </button>

        <button
          onClick={() => setActiveTab('lead')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'lead' ? 'text-amber-400' : 'text-slate-400'
          }`}
        >
          <Navigation className="w-5 h-5" />
          <span>Dispatch</span>
        </button>

        <button
          onClick={() => setActiveTab('customer')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'customer' ? 'text-emerald-400' : 'text-slate-400'
          }`}
        >
          <MapPin className="w-5 h-5" />
          <span>Tracking</span>
        </button>

        <button
          onClick={() => setActiveTab('company')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'company' ? 'text-blue-400' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span>Fleet</span>
        </button>
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
