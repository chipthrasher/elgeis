// Leaflet-Geoman patches the global `L`, which a bundled Leaflet doesn't set.
// Imported just before it (see draw.ts), so it patches our Leaflet.

import L from 'leaflet'

Object.assign(window, { L })
