import 'leaflet'

declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean
    bearing?: number
    touchRotate?: boolean
    shiftKeyRotate?: boolean
    rotateControl?: boolean | { position?: string, closeOnZeroBearing?: boolean }
    compassBearing?: boolean
  }

  interface Map {
    setBearing(bearing: number): this
    getBearing(): number
  }
}

declare module 'leaflet-rotate/dist/leaflet-rotate.js' {
  const plugin: unknown
  export default plugin
}
