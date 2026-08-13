// Shared with ProductsPage.jsx and src/components/AIChatBubble.jsx (Product
// Catalog AI) — a single source of truth so the AI's allowed device_type
// values never drift out of sync with the dropdown a human fills by hand.
export const DEVICE_TYPES = [
  'IoT Logger', 'Temperature Sensor', 'Humidity Sensor', 'Pressure Sensor', 'Gateway',
  'Flow Meter', 'GPS Tracker', 'Vibration Sensor', 'Camera Module', 'Power Meter', 'Other',
]
