import { NorthLebanonLocation } from '../types';

export const NORTH_LEBANON_BOUNDS = {
  center: [34.4367, 35.8308] as [number, number], // Tripoli Center
  minLat: 34.15,
  maxLat: 34.65,
  minLng: 35.60,
  maxLng: 36.15,
  defaultZoom: 12,
};

export const NORTH_LEBANON_HUBS: NorthLebanonLocation[] = [
  {
    name: 'Tripoli Port (El-Mina)',
    area: 'Tripoli - El Mina',
    lat: 34.4512,
    lng: 35.8194,
    type: 'port',
  },
  {
    name: 'Al-Tal Square (Tripoli Center)',
    area: 'Tripoli Central',
    lat: 34.4367,
    lng: 35.8308,
    type: 'city',
  },
  {
    name: 'Tripoli Boulevard (Al-Hallab 1881)',
    area: 'Tripoli Commercial',
    lat: 34.4312,
    lng: 35.8398,
    type: 'commercial',
  },
  {
    name: 'Dam & Farez (Nini Hospital)',
    area: 'Tripoli Medical Hub',
    lat: 34.4285,
    lng: 35.8361,
    type: 'hospital',
  },
  {
    name: 'Beddawi Refinery Junction',
    area: 'North Tripoli / Beddawi',
    lat: 34.4601,
    lng: 35.8654,
    type: 'industrial',
  },
  {
    name: 'Saydet Zgharta Roundabout',
    area: 'Zgharta',
    lat: 34.3995,
    lng: 35.8941,
    type: 'city',
  },
  {
    name: 'Chekka Coastal Highway & Tunnel',
    area: 'Chekka',
    lat: 34.3325,
    lng: 35.7289,
    type: 'highway',
  },
  {
    name: 'Batroun Old Souks & Port',
    area: 'Batroun',
    lat: 34.2558,
    lng: 35.6601,
    type: 'city',
  },
  {
    name: 'University of Balamand Campus',
    area: 'Koura - Kelhat',
    lat: 34.3672,
    lng: 35.7954,
    type: 'commercial',
  },
  {
    name: 'Amioun Town Center',
    area: 'Koura - Amioun',
    lat: 34.3015,
    lng: 35.8123,
    type: 'city',
  },
  {
    name: 'Halba Central Square',
    area: 'Akkar - Halba',
    lat: 34.5422,
    lng: 36.0811,
    type: 'city',
  },
  {
    name: 'Ehden Al-Midan',
    area: 'Zgharta Mountains - Ehden',
    lat: 34.2985,
    lng: 35.9814,
    type: 'city',
  },
];

// Pre-computed realistic road routes in North Lebanon for GPS simulation and testing
export const SIMULATED_ROUTES = {
  tripoliMina: [
    { lat: 34.4512, lng: 35.8194, speed: 38 }, // Port El-Mina
    { lat: 34.4475, lng: 35.8235, speed: 42 },
    { lat: 34.4420, lng: 35.8280, speed: 35 },
    { lat: 34.4367, lng: 35.8308, speed: 28 }, // Al-Tal
    { lat: 34.4320, lng: 35.8350, speed: 45 },
    { lat: 34.4285, lng: 35.8361, speed: 30 }, // Dam & Farez
    { lat: 34.4240, lng: 35.8390, speed: 48 },
    { lat: 34.4200, lng: 35.8430, speed: 52 }, // Bahsas entry
  ],
  coastalHighway: [
    { lat: 34.4150, lng: 35.8350, speed: 72 }, // South Tripoli
    { lat: 34.3850, lng: 35.7980, speed: 85 }, // Al-Qalamoun
    { lat: 34.3520, lng: 35.7510, speed: 88 }, // Enfeh
    { lat: 34.3312, lng: 35.7312, speed: 65 }, // Chekka Tunnel
    { lat: 34.2950, lng: 35.6980, speed: 82 }, // Hamat/Heri
    { lat: 34.2700, lng: 35.6720, speed: 75 }, // Kfaraabida
    { lat: 34.2558, lng: 35.6601, speed: 40 }, // Batroun
  ],
  zghartaRoute: [
    { lat: 34.4312, lng: 35.8398, speed: 35 }, // Tripoli Boulevard
    { lat: 34.4210, lng: 35.8560, speed: 50 }, // Mejdlaya road
    { lat: 34.4120, lng: 35.8720, speed: 55 },
    { lat: 34.4050, lng: 35.8850, speed: 45 },
    { lat: 34.3995, lng: 35.8941, speed: 32 }, // Zgharta Roundabout
    { lat: 34.3920, lng: 35.9080, speed: 40 }, // Ardeh
  ],
};
