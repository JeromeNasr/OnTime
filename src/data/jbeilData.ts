import { NorthLebanonLocation } from '../types';

// Optimized specifically for Jbeil (Byblos) University Dorm & Campus Transportation
export const JBEIL_BOUNDS = {
  center: [34.1235, 35.6560] as [number, number], // Jbeil / Blat Campus Center
  minLat: 34.08,
  maxLat: 34.18,
  minLng: 35.61,
  maxLng: 35.70,
  defaultZoom: 14,
};

// Aliased for backward compatibility
export const NORTH_LEBANON_BOUNDS = JBEIL_BOUNDS;

export const JBEIL_HUBS: NorthLebanonLocation[] = [
  {
    name: 'LAU Byblos - Upper Gate & Residence Hall',
    area: 'LAU Byblos Campus / Dorms',
    lat: 34.1238,
    lng: 35.6698,
    type: 'commercial',
  },
  {
    name: 'LAU Byblos - Lower Gate (Science & Engineering)',
    area: 'LAU Byblos Campus',
    lat: 34.1248,
    lng: 35.6662,
    type: 'commercial',
  },
  {
    name: 'Blat - Campus Crest Student Residences',
    area: 'Blat Student Housing',
    lat: 34.1215,
    lng: 35.6630,
    type: 'city',
  },
  {
    name: 'Blat - Green House Student Dorms',
    area: 'Blat Student Housing',
    lat: 34.1202,
    lng: 35.6605,
    type: 'city',
  },
  {
    name: 'Mastita - Student Village & Housing',
    area: 'Mastita Dorms',
    lat: 34.1165,
    lng: 35.6558,
    type: 'city',
  },
  {
    name: 'Jbeil Voie 13 / Highway Hub',
    area: 'Jbeil Center',
    lat: 34.1265,
    lng: 35.6520,
    type: 'highway',
  },
  {
    name: 'Jbeil Old Souk & Roman Citadel',
    area: 'Jbeil Coastal Souks',
    lat: 34.1215,
    lng: 35.6455,
    type: 'city',
  },
  {
    name: 'Notre Dame Maritime Hospital',
    area: 'Jbeil Medical Center',
    lat: 34.1285,
    lng: 35.6505,
    type: 'hospital',
  },
  {
    name: 'Hboub - Student Residences',
    area: 'Hboub / St. Charbel Road',
    lat: 34.1350,
    lng: 35.6720,
    type: 'city',
  },
  {
    name: 'Amchit Coastal Junction',
    area: 'Amchit',
    lat: 34.1480,
    lng: 35.6420,
    type: 'highway',
  },
  {
    name: 'Halat - Student Residences',
    area: 'Halat / Fidar',
    lat: 34.0950,
    lng: 35.6500,
    type: 'city',
  },
];

export const JBEIL_DORM_HUBS = JBEIL_HUBS;
export const NORTH_LEBANON_HUBS = JBEIL_HUBS;

// Pre-computed realistic road routes in Jbeil for GPS simulation and testing
export const SIMULATED_ROUTES = {
  // Route 1: Blat Student Dorms to LAU Byblos Upper Gate
  lauCampusLoop: [
    { lat: 34.1202, lng: 35.6605, speed: 28 }, // Green House Dorms
    { lat: 34.1215, lng: 35.6630, speed: 32 }, // Campus Crest
    { lat: 34.1228, lng: 35.6648, speed: 35 }, // Blat Main Road
    { lat: 34.1245, lng: 35.6662, speed: 26 }, // LAU Lower Gate
    { lat: 34.1250, lng: 35.6680, speed: 22 }, // Campus incline
    { lat: 34.1238, lng: 35.6698, speed: 18 }, // Residence Hall / Upper Gate
  ],
  // Route 2: Jbeil Old Souk to LAU Campus
  oldSoukRoute: [
    { lat: 34.1215, lng: 35.6455, speed: 25 }, // Old Souk
    { lat: 34.1235, lng: 35.6490, speed: 34 }, // Central roundabout
    { lat: 34.1255, lng: 35.6565, speed: 40 }, // Highway connector
    { lat: 34.1240, lng: 35.6620, speed: 35 }, // Blat ascent
    { lat: 34.1238, lng: 35.6698, speed: 22 }, // LAU Byblos
  ],
  // Route 3: Highway & Mastita Link
  highwayRoute: [
    { lat: 34.1265, lng: 35.6520, speed: 45 }, // Voie 13
    { lat: 34.1255, lng: 35.6565, speed: 42 }, // Blat overpass
    { lat: 34.1240, lng: 35.6610, speed: 38 }, // Blat ascending
    { lat: 34.1225, lng: 35.6640, speed: 32 }, // Dorms corridor
    { lat: 34.1248, lng: 35.6662, speed: 24 }, // LAU Campus Gate
  ],
  // Backwards compatibility aliases
  lauDormsToCampus: [
    { lat: 34.1202, lng: 35.6605, speed: 28 },
    { lat: 34.1215, lng: 35.6630, speed: 32 },
    { lat: 34.1228, lng: 35.6648, speed: 35 },
    { lat: 34.1245, lng: 35.6662, speed: 26 },
    { lat: 34.1250, lng: 35.6680, speed: 22 },
    { lat: 34.1238, lng: 35.6698, speed: 18 },
  ],
  tripoliMina: [
    { lat: 34.1202, lng: 35.6605, speed: 28 },
    { lat: 34.1215, lng: 35.6630, speed: 32 },
    { lat: 34.1228, lng: 35.6648, speed: 35 },
    { lat: 34.1245, lng: 35.6662, speed: 26 },
    { lat: 34.1238, lng: 35.6698, speed: 18 },
  ],
};
