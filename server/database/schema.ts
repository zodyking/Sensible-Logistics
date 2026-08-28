/**
 * Container Tracker — PostgreSQL schema (Drizzle ORM).
 *
 * Design rules enforced here (spec 17, 18):
 *  - Every tenant-scoped table carries `company_id`.
 *  - All timestamps are `timestamptz` (UTC); display timezone lives on the location.
 *  - `containers` holds denormalised current-state fields that are only ever
 *    written inside the same transaction as the authoritative `container_events` row.
 *  - A normalised container number is unique per company, active or not.
 *  - At most one active movement claim may exist per container (partial unique index).
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/* ============================================================
   Geospatial storage
   Boundaries are GeoJSON polygons in `jsonb` and points are plain
   latitude/longitude columns, so the app runs on a stock PostgreSQL server
   with no extensions. Distances are computed with the haversine formula.
   ============================================================ */

/** GeoJSON Polygon: rings of [longitude, latitude] pairs, WGS 84. */
export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}

const utc = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/* ============================================================
   Enums
   ============================================================ */

export const roleEnum = pgEnum('role', ['DRIVER', 'ADMIN'])
export const membershipStatusEnum = pgEnum('membership_status', ['PENDING', 'ACTIVE', 'SUSPENDED'])
export const driverStatusEnum = pgEnum('driver_status', ['AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'INACTIVE'])

export const activePoolStateEnum = pgEnum('active_pool_state', [
  'INACTIVE',
  'PICKUP_IN_PROGRESS',
  'DRIVER_CUSTODY',
  'AT_LOCATION',
  'EXCEPTION',
])

export const containerTypeEnum = pgEnum('container_type', ['TROPICAL', 'ZIM', 'CMA', 'KING_OCEAN'])

export const containerStatusEnum = pgEnum('container_status', [
  'AVAILABLE',
  'IN_TRANSIT',
  'AT_YARD',
  'LOADING',
  'RETURNED',
])

export const equipmentTypeEnum = pgEnum('equipment_type', [
  'DRY_20',
  'DRY_40',
  'HC_40',
  'HC_45',
  'REEFER',
  'TANK',
  'OPEN_TOP',
  'FLAT_RACK',
  'OTHER',
])

export const chassisStatusEnum = pgEnum('chassis_status', ['AVAILABLE', 'IN_USE', 'OUT_OF_SERVICE'])

export const tripStatusEnum = pgEnum('trip_status', [
  'DRAFT',
  'PICKUP_IN_PROGRESS',
  'IN_TRANSIT',
  'DROPOFF_IN_PROGRESS',
  'DROPPED_OFF',
  'COMPLETED',
  'CANCELLED',
  'EXCEPTION',
])

export const eventTypeEnum = pgEnum('event_type', [
  'PICKUP_STARTED',
  'PICKUP_CONFIRMED',
  'DROPOFF_STARTED',
  'DROPOFF_CONFIRMED',
  'GATE_IN',
  'GATE_OUT',
  'ARRIVED',
  'DEPARTED',
  'YARD_MOVE',
  'CHASSIS_ATTACH',
  'CHASSIS_DETACH',
  'LOADED',
  'EMPTIED',
  'DOCUMENT_ADDED',
  'DAMAGE_REPORTED',
  'CORRECTION',
  'STATUS_CHANGE',
  'RELEASED',
  'ACTIVATED',
  'PICKUP_CANCELLED',
])

export const eventSourceEnum = pgEnum('event_source', [
  'MANUAL',
  'OCR',
  'GEOFENCE',
  'IMPORT',
  'API',
  'ADMIN_EDIT',
  'SYSTEM',
])

export const locationTypeEnum = pgEnum('location_type', [
  'COMPANY_YARD',
  'CUSTOMER',
  'MARINE_TERMINAL',
  'RAIL_TERMINAL',
])

export const locationStatusEnum = pgEnum('location_status', ['ACTIVE', 'PENDING_APPROVAL', 'ARCHIVED'])

export const yardObjectTypeEnum = pgEnum('yard_object_type', [
  'BUILDING',
  'ROAD',
  'FENCE',
  'GATE',
  'SLOT',
  'ROW',
  'LABEL',
  'RESTRICTED',
  'PARKING',
])

export const documentCategoryEnum = pgEnum('document_category', [
  'EIR',
  'POD',
  'BILL_OF_LADING',
  'DELIVERY_ORDER',
  'GATE_TICKET',
  'SCALE_TICKET',
  'DAMAGE_REPORT',
  'REPAIR_INVOICE',
  'CUSTOMS',
  'PHOTO',
  'OTHER',
])

export const ocrStatusEnum = pgEnum('ocr_status', ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'NOT_IMPLEMENTED'])
export const ocrSourceTypeEnum = pgEnum('ocr_source_type', ['CONTAINER', 'CHASSIS', 'SEAL', 'DOCUMENT'])
export const ocrValidationEnum = pgEnum('ocr_validation_status', ['VALID', 'INVALID', 'UNVERIFIED'])

export const damageSeverityEnum = pgEnum('damage_severity', ['MINOR', 'MODERATE', 'SEVERE', 'OUT_OF_SERVICE'])

export const notificationStatusEnum = pgEnum('notification_status', ['PENDING', 'DELIVERED', 'READ', 'DISMISSED'])

export const timecardStatusEnum = pgEnum('timecard_status', ['OPEN', 'COMPLETED', 'LOCKED'])
export const shortHaulStatusEnum = pgEnum('short_haul_status', ['QUALIFIED', 'AT_RISK', 'NOT_AVAILABLE', 'UNKNOWN'])
export const cycleTypeEnum = pgEnum('cycle_type', ['SIXTY_SEVEN', 'SEVENTY_EIGHT'])
export const radiusEvidenceEnum = pgEnum('radius_evidence_level', ['NONE', 'RECORDED_LOCATIONS_ONLY', 'GPS_VERIFIED'])

/* ============================================================
   Tenancy and identity
   ============================================================ */

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  usdotNumber: text('usdot_number'),
  /** Shared code used by the public driver signup flow to join a company. */
  inviteCode: text('invite_code').notNull(),
  timezone: text('timezone').notNull().default('America/New_York'),
  cycleType: cycleTypeEnum('cycle_type').notNull().default('SEVENTY_EIGHT'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('companies_invite_code_key').on(t.inviteCode)])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  mobileNumber: text('mobile_number'),
  emailVerifiedAt: utc('email_verified_at'),
  phoneVerifiedAt: utc('phone_verified_at'),
  profilePhotoUrl: text('profile_photo_url'),
  lastLoginAt: utc('last_login_at'),
  disabledAt: utc('disabled_at'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)])

/**
 * Single-use email verification links (spec 4).
 *
 * Only the SHA-256 digest of the token is stored, so a database leak cannot be
 * replayed to take over an unverified account. Rows are kept after use as an
 * audit trail of which address was confirmed and when.
 */
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  /** Address the link was sent to — may differ from the current user email. */
  sentToEmail: text('sent_to_email').notNull(),
  expiresAt: utc('expires_at').notNull(),
  consumedAt: utc('consumed_at'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('email_verification_tokens_hash_key').on(t.tokenHash),
  index('email_verification_tokens_user_idx').on(t.userId),
])

/**
 * One-time SMS codes sent through the selected Quo platform number.
 * The raw code and the post-verify ticket are stored only as SHA-256 digests.
 */
export const phoneChallenges = pgTable('phone_challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose').notNull(),
  phoneE164: text('phone_e164').notNull(),
  codeHash: text('code_hash').notNull(),
  ticketHash: text('ticket_hash'),
  attemptCount: integer('attempt_count').notNull().default(0),
  expiresAt: utc('expires_at').notNull(),
  verifiedAt: utc('verified_at'),
  consumedAt: utc('consumed_at'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [
  index('phone_challenges_phone_idx').on(t.companyId, t.phoneE164, t.purpose),
  index('phone_challenges_ticket_idx').on(t.ticketHash),
])

export const companyMemberships = pgTable('company_memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Exactly one role per membership (spec 3). */
  role: roleEnum('role').notNull(),
  status: membershipStatusEnum('status').notNull().default('ACTIVE'),
  invitedByUserId: uuid('invited_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('company_memberships_company_user_key').on(t.companyId, t.userId),
  index('company_memberships_user_idx').on(t.userId),
])

export const drivers = pgTable('drivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  driverCode: text('driver_code'),
  cdlNumber: text('cdl_number'),
  cdlState: text('cdl_state'),
  /** Normal work reporting location — anchors the 150 air-mile radius check. */
  homeTerminalLocationId: uuid('home_terminal_location_id'),
  preferredTruckId: uuid('preferred_truck_id'),
  status: driverStatusEnum('status').notNull().default('AVAILABLE'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('drivers_company_user_key').on(t.companyId, t.userId),
  index('drivers_company_idx').on(t.companyId),
])

export const trucks = pgTable('trucks', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  unitNumber: text('unit_number').notNull(),
  plate: text('plate'),
  vin: text('vin'),
  assignedDriverId: uuid('assigned_driver_id'),
  active: boolean('active').notNull().default(true),
  notes: text('notes'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [uniqueIndex('trucks_company_unit_key').on(t.companyId, t.unitNumber)])

/* ============================================================
   Locations and geospatial model
   ============================================================ */

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: locationTypeEnum('type').notNull(),
  locationCode: text('location_code'),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),

  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country').notNull().default('US'),
  /** Lower-cased, whitespace-collapsed address used for duplicate detection. */
  normalizedAddress: text('normalized_address'),

  /** Site centre point. Proximity search reads these directly. */
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  /** Operational perimeter drawn on OpenStreetMap. */
  boundary: jsonb('boundary').$type<GeoJsonPolygon>(),
  /** Clockwise map bearing in degrees so the yard sits square to the street. */
  mapHeading: real('map_heading').notNull().default(0),

  timezone: text('timezone').notNull().default('America/New_York'),
  hours: text('hours'),
  appointmentRequired: boolean('appointment_required').notNull().default(false),
  /** Switchboard / main company line for this site. */
  mainPhone: text('main_phone'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  gateInstructions: text('gate_instructions'),
  driverNotes: text('driver_notes'),
  capacity: integer('capacity'),

  status: locationStatusEnum('status').notNull().default('ACTIVE'),
  createdByUserId: uuid('created_by_user_id'),
  approvedByUserId: uuid('approved_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
  deletedAt: utc('deleted_at'),
}, t => [
  index('locations_company_idx').on(t.companyId),
  index('locations_company_name_idx').on(t.companyId, t.name),
  index('locations_normalized_address_idx').on(t.companyId, t.normalizedAddress),
])

export const locationZones = pgTable('location_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  purpose: text('purpose'),
  boundary: jsonb('boundary').$type<GeoJsonPolygon>(),
  /** Local yard-plane rectangle, kept distinct from the geographic layer (spec 32.2). */
  localGeometry: jsonb('local_geometry').$type<Record<string, unknown>>(),
  capacity: integer('capacity'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('location_zones_location_idx').on(t.locationId)])

export const yardLayouts = pgTable('yard_layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  name: text('name'),
  isCurrent: boolean('is_current').notNull().default(true),
  /** Yard-plane extents in local units. */
  planeWidth: real('plane_width').notNull().default(1000),
  planeHeight: real('plane_height').notNull().default(700),
  /** Affine transform between the geographic boundary and the local plane. */
  geoTransform: jsonb('geo_transform').$type<Record<string, number>>(),
  supportsStacking: boolean('supports_stacking').notNull().default(false),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [
  index('yard_layouts_location_idx').on(t.locationId),
  uniqueIndex('yard_layouts_location_version_key').on(t.locationId, t.version),
])

export const yardObjects = pgTable('yard_objects', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  layoutId: uuid('layout_id').notNull().references(() => yardLayouts.id, { onDelete: 'cascade' }),
  type: yardObjectTypeEnum('type').notNull(),
  label: text('label'),
  x: real('x').notNull(),
  y: real('y').notNull(),
  width: real('width').notNull(),
  height: real('height').notNull(),
  rotation: real('rotation').notNull().default(0),
  zoneId: uuid('zone_id'),
  slotCode: text('slot_code'),
  style: jsonb('style').$type<Record<string, unknown>>(),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('yard_objects_layout_idx').on(t.layoutId)])

/* ============================================================
   Equipment
   ============================================================ */

export const chassis = pgTable('chassis', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  number: text('number').notNull(),
  numberNormalized: text('number_normalized').notNull(),
  provider: text('provider'),
  sizeCompatibility: text('size_compatibility'),
  licensePlate: text('license_plate'),
  vin: text('vin'),
  status: chassisStatusEnum('status').notNull().default('AVAILABLE'),
  outOfService: boolean('out_of_service').notNull().default(false),
  currentContainerId: uuid('current_container_id'),
  currentLocationId: uuid('current_location_id'),
  notes: text('notes'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
  deletedAt: utc('deleted_at'),
}, t => [
  uniqueIndex('chassis_company_number_key').on(t.companyId, t.numberNormalized),
  index('chassis_company_idx').on(t.companyId),
])

export const containers = pgTable('containers', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  /** As displayed, e.g. `MSCU 452189-4`. */
  number: text('number').notNull(),
  /** Uppercase, punctuation-stripped. Unique per company, active or not (spec 18). */
  numberNormalized: text('number_normalized').notNull(),
  checkDigitValid: boolean('check_digit_valid').notNull().default(false),

  /** Business classification — distinct from equipment size/type (spec 5.1). */
  containerType: containerTypeEnum('container_type').notNull(),
  equipmentType: equipmentTypeEnum('equipment_type').notNull().default('DRY_40'),
  isLoaded: boolean('is_loaded').notNull().default(false),
  /**
   * Where the box sits in the current service life (customer drop-off →
   * Loading). Distinct from cargo loaded/empty and from active-pool state.
   */
  containerStatus: containerStatusEnum('container_status').notNull().default('AVAILABLE'),

  sealNumber: text('seal_number'),
  bookingNumber: text('booking_number'),
  billOfLading: text('bill_of_lading'),
  customerReference: text('customer_reference'),
  purchaseOrder: text('purchase_order'),
  releaseNumber: text('release_number'),
  commodity: text('commodity'),
  steamshipLine: text('steamship_line'),
  terminalReference: text('terminal_reference'),

  /* --- Denormalised current state, written only alongside an event --- */
  activePoolState: activePoolStateEnum('active_pool_state').notNull().default('INACTIVE'),
  currentDriverId: uuid('current_driver_id'),
  currentLocationId: uuid('current_location_id'),
  activeMovementId: uuid('active_movement_id'),
  currentChassisId: uuid('current_chassis_id'),
  activatedAt: utc('activated_at'),
  releasedAt: utc('released_at'),
  lastActivityAt: utc('last_activity_at'),

  /* --- Deadlines and financial exposure --- */
  availabilityDate: date('availability_date'),
  lastFreeDay: date('last_free_day'),
  emptyReturnDeadline: date('empty_return_deadline'),
  appointmentAt: utc('appointment_at'),

  /* --- Special handling flags --- */
  isReefer: boolean('is_reefer').notNull().default(false),
  isHazmat: boolean('is_hazmat').notNull().default(false),
  isOverweight: boolean('is_overweight').notNull().default(false),
  isDamaged: boolean('is_damaged').notNull().default(false),
  customsHold: boolean('customs_hold').notNull().default(false),
  isUrgent: boolean('is_urgent').notNull().default(false),
  doNotMove: boolean('do_not_move').notNull().default(false),

  notes: text('notes'),
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  /** Optimistic-locking counter for mutable state (spec 18). */
  version: integer('version').notNull().default(1),

  createdByUserId: uuid('created_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
  deletedAt: utc('deleted_at'),
}, t => [
  uniqueIndex('containers_company_number_key').on(t.companyId, t.numberNormalized),
  index('containers_company_state_idx').on(t.companyId, t.activePoolState),
  index('containers_company_status_idx').on(t.companyId, t.containerStatus),
  index('containers_current_location_idx').on(t.currentLocationId),
  index('containers_current_driver_idx').on(t.currentDriverId),
])

/* ============================================================
   Movements
   ============================================================ */

export const trips = pgTable('trips', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  /** Human-readable work-order reference, e.g. `TRP-1042`. */
  reference: text('reference').notNull(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  truckId: uuid('truck_id'),
  containerId: uuid('container_id').references(() => containers.id),
  chassisId: uuid('chassis_id'),
  /** CONTAINER (box on a chassis or bobtail) or BARE_CHASSIS (chassis only). */
  kind: text('kind').notNull().default('CONTAINER'),

  originLocationId: uuid('origin_location_id'),
  destinationLocationId: uuid('destination_location_id'),

  status: tripStatusEnum('status').notNull().default('DRAFT'),
  isLoaded: boolean('is_loaded').notNull().default(false),
  sealNumber: text('seal_number'),
  customer: text('customer'),
  steamshipLine: text('steamship_line'),
  referenceNumbers: jsonb('reference_numbers').$type<Record<string, string>>().notNull().default({}),

  plannedPickupAt: utc('planned_pickup_at'),
  appointmentAt: utc('appointment_at'),
  plannedDeliveryAt: utc('planned_delivery_at'),
  pickedUpAt: utc('picked_up_at'),
  droppedOffAt: utc('dropped_off_at'),
  completedAt: utc('completed_at'),
  cancelledAt: utc('cancelled_at'),

  /** Marks the drop-off that removes the container from the active pool. */
  isFinalRelease: boolean('is_final_release').notNull().default(false),
  exceptionType: text('exception_type'),
  driverNotes: text('driver_notes'),
  reviewNotes: text('review_notes'),
  requiredDocuments: jsonb('required_documents').$type<string[]>().notNull().default([]),
  version: integer('version').notNull().default(1),

  createdAt: utc('created_at').notNull().defaultNow(),
  updatedAt: utc('updated_at').notNull().defaultNow(),
}, t => [
  uniqueIndex('trips_company_reference_key').on(t.companyId, t.reference),
  index('trips_driver_status_idx').on(t.driverId, t.status),
  index('trips_company_status_idx').on(t.companyId, t.status),
  /**
   * At most one live movement claim per container (spec 18). Enforced in the
   * database so two drivers racing on the same number cannot both win.
   */
  uniqueIndex('trips_one_active_claim_per_container')
    .on(t.containerId)
    .where(sql`status in ('PICKUP_IN_PROGRESS','IN_TRANSIT','DROPOFF_IN_PROGRESS')`),
])

export const tripStops = pgTable('trip_stops', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  locationId: uuid('location_id'),
  plannedAt: utc('planned_at'),
  arrivedAt: utc('arrived_at'),
  departedAt: utc('departed_at'),
  notes: text('notes'),
}, t => [uniqueIndex('trip_stops_trip_sequence_key').on(t.tripId, t.sequence)])

/* ============================================================
   Immutable event timeline
   ============================================================ */

export const containerEvents = pgTable('container_events', {
  /**
   * Client-generated UUID. Reused verbatim on offline retries so the insert is
   * naturally idempotent (spec 20, 33.2).
   */
  id: uuid('id').primaryKey(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  containerId: uuid('container_id').references(() => containers.id, { onDelete: 'cascade' }),

  eventType: eventTypeEnum('event_type').notNull(),
  /** Actual moment the event happened in the real world. */
  occurredAt: utc('occurred_at').notNull(),
  /** Moment the record reached the server — delayed entry stays visible. */
  createdAt: utc('created_at').notNull().defaultNow(),

  actorUserId: uuid('actor_user_id'),
  actorDriverId: uuid('actor_driver_id'),
  source: eventSourceEnum('source').notNull().default('MANUAL'),

  tripId: uuid('trip_id'),
  locationId: uuid('location_id'),
  chassisId: uuid('chassis_id'),
  gpsLatitude: numeric('gps_latitude', { precision: 10, scale: 7 }),
  gpsLongitude: numeric('gps_longitude', { precision: 10, scale: 7 }),
  /** Reported accuracy in metres; stored with every geofence-derived signal. */
  gpsAccuracyMeters: real('gps_accuracy_meters'),

  /** x/y/rotation/zone/slot/stack when the event carries a yard position. */
  yardPosition: jsonb('yard_position').$type<Record<string, unknown>>(),
  /** Structured payload: previous/next state, seal, notes, OCR references. */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  notes: text('notes'),

  /** Set when this row records a correction to an earlier event. */
  correctsEventId: uuid('corrects_event_id'),
}, t => [
  index('container_events_container_idx').on(t.containerId, t.occurredAt),
  index('container_events_company_idx').on(t.companyId, t.occurredAt),
  index('container_events_trip_idx').on(t.tripId),
])

export const containerPlacements = pgTable('container_placements', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  containerId: uuid('container_id').notNull().references(() => containers.id, { onDelete: 'cascade' }),
  locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
  layoutId: uuid('layout_id'),
  zoneId: uuid('zone_id'),
  slotCode: text('slot_code'),
  /** Local metres east/north of the location's south-west corner. */
  x: real('x').notNull(),
  y: real('y').notNull(),
  rotation: real('rotation').notNull().default(0),
  /** WGS 84 pin used to draw the box on OpenStreetMap. */
  latitude: numeric('latitude', { precision: 10, scale: 7 }),
  longitude: numeric('longitude', { precision: 10, scale: 7 }),
  stackLevel: integer('stack_level').notNull().default(0),
  /** Null while this is the container's current position. */
  supersededAt: utc('superseded_at'),
  eventId: uuid('event_id'),
  placedByUserId: uuid('placed_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [
  index('container_placements_container_idx').on(t.containerId),
  index('container_placements_location_idx').on(t.locationId, t.supersededAt),
])

/* ============================================================
   Documents, OCR, damage
   ============================================================ */

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  category: documentCategoryEnum('category').notNull().default('OTHER'),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  /** Object key inside the private SeaweedFS S3 bucket — never a public URL. */
  storageKey: text('storage_key').notNull(),
  thumbnailKey: text('thumbnail_key'),
  checksum: text('checksum'),

  containerId: uuid('container_id'),
  tripId: uuid('trip_id'),
  chassisId: uuid('chassis_id'),
  locationId: uuid('location_id'),
  eventId: uuid('event_id'),

  /** Flat text index built from OCR output for global search (spec 11). */
  extractedText: text('extracted_text'),
  ocrStatus: ocrStatusEnum('ocr_status').notNull().default('PENDING'),
  replacesDocumentId: uuid('replaces_document_id'),
  uploadedByUserId: uuid('uploaded_by_user_id'),
  createdAt: utc('created_at').notNull().defaultNow(),
  deletedAt: utc('deleted_at'),
}, t => [
  index('documents_company_idx').on(t.companyId, t.createdAt),
  index('documents_container_idx').on(t.containerId),
  index('documents_trip_idx').on(t.tripId),
])

export const ocrResults = pgTable('ocr_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  sourceDocumentId: uuid('source_document_id'),
  sourceType: ocrSourceTypeEnum('source_type').notNull(),

  engine: text('engine').notNull().default('paddleocr'),
  engineVersion: text('engine_version'),
  modelName: text('model_name'),
  /** Which OpenCV preprocessing profile and crop produced this attempt. */
  preprocessingProfile: text('preprocessing_profile'),

  status: ocrStatusEnum('status').notNull().default('PENDING'),
  startedAt: utc('started_at'),
  completedAt: utc('completed_at'),

  rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
  detectedRegions: jsonb('detected_regions').$type<unknown[]>(),
  /** Ranked candidates, not a single magic string (spec 34). */
  candidateValues: jsonb('candidate_values').$type<unknown[]>(),
  selectedValue: text('selected_value'),
  confidence: real('confidence'),
  validationStatus: ocrValidationEnum('validation_status').notNull().default('UNVERIFIED'),
  checkDigitValid: boolean('check_digit_valid'),

  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: utc('reviewed_at'),
  correctionReason: text('correction_reason'),
  latencyMs: integer('latency_ms'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('ocr_results_company_idx').on(t.companyId, t.createdAt)])

export const damageReports = pgTable('damage_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  containerId: uuid('container_id'),
  chassisId: uuid('chassis_id'),
  tripId: uuid('trip_id'),
  eventId: uuid('event_id'),
  severity: damageSeverityEnum('severity').notNull().default('MINOR'),
  area: text('area'),
  description: text('description').notNull(),
  reportedByUserId: uuid('reported_by_user_id'),
  resolvedAt: utc('resolved_at'),
  resolutionNotes: text('resolution_notes'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('damage_reports_company_idx').on(t.companyId, t.createdAt)])

/* ============================================================
   Notifications and audit
   ============================================================ */

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  /** In-app route the notification points at. */
  deepLink: text('deep_link'),
  status: notificationStatusEnum('status').notNull().default('PENDING'),
  readAt: utc('read_at'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('notifications_user_idx').on(t.userId, t.status)])

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before').$type<Record<string, unknown>>(),
  after: jsonb('after').$type<Record<string, unknown>>(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('audit_logs_company_idx').on(t.companyId, t.createdAt)])

/* ============================================================
   FMCSA 150 air-mile short-haul time records (spec 14.6)
   Retention: 6 months minimum; deletion is blocked inside that window.
   ============================================================ */

export const driverTimecards = pgTable('driver_timecards', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  /** Calendar day in the reporting location's timezone. */
  workDate: date('work_date').notNull(),
  reportingLocationId: uuid('reporting_location_id'),

  /** Authoritative Clock In — never inferred from the first pickup (spec 14.2). */
  reportedForDutyAt: utc('reported_for_duty_at'),
  releasedFromDutyAt: utc('released_from_duty_at'),
  totalOnDutyMinutes: integer('total_on_duty_minutes').notNull().default(0),

  status: timecardStatusEnum('status').notNull().default('OPEN'),
  shortHaulStatus: shortHaulStatusEnum('short_haul_status').notNull().default('UNKNOWN'),
  cycleType: cycleTypeEnum('cycle_type').notNull().default('SEVENTY_EIGHT'),
  /** Rolling total for the 7 days preceding this work date — §395.8(j)(2). */
  preceding7DayMinutes: integer('preceding_7_day_minutes').notNull().default(0),

  createdAt: utc('created_at').notNull().defaultNow(),
  completedAt: utc('completed_at'),
  /** Earliest date this record may be purged. Enforced by the service layer. */
  retainUntil: date('retain_until'),
}, t => [
  uniqueIndex('driver_timecards_driver_date_key').on(t.driverId, t.workDate),
  index('driver_timecards_company_date_idx').on(t.companyId, t.workDate),
])

export const timecardBreaks = pgTable('timecard_breaks', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  timecardId: uuid('timecard_id').notNull().references(() => driverTimecards.id, { onDelete: 'cascade' }),
  startedAt: utc('started_at').notNull(),
  endedAt: utc('ended_at'),
  /** Only true off-duty intervals reduce the daily on-duty total. */
  countedAsOffDuty: boolean('counted_as_off_duty').notNull().default(true),
  reason: text('reason'),
  createdAt: utc('created_at').notNull().defaultNow(),
}, t => [index('timecard_breaks_timecard_idx').on(t.timecardId)])

export const timecardComplianceChecks = pgTable('timecard_compliance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  timecardId: uuid('timecard_id').notNull().references(() => driverTimecards.id, { onDelete: 'cascade' }),
  priorOffDutyMinutes: integer('prior_off_duty_minutes'),
  /** Straight-line geodesic miles from the reporting location — never road miles. */
  maxRecordedAirMiles: real('max_recorded_air_miles'),
  returnedToReportingLocation: boolean('returned_to_reporting_location'),
  releasedWithin14Hours: boolean('released_within_14_hours'),
  rollingCycleMinutes: integer('rolling_cycle_minutes'),
  radiusEvidenceLevel: radiusEvidenceEnum('radius_evidence_level').notNull().default('RECORDED_LOCATIONS_ONLY'),
  evaluatedAt: utc('evaluated_at').notNull().defaultNow(),
}, t => [uniqueIndex('timecard_compliance_checks_timecard_key').on(t.timecardId)])

export const timecardCorrections = pgTable('timecard_corrections', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  timecardId: uuid('timecard_id').notNull().references(() => driverTimecards.id, { onDelete: 'cascade' }),
  fieldName: text('field_name').notNull(),
  originalValue: text('original_value'),
  correctedValue: text('corrected_value'),
  changedByUserId: uuid('changed_by_user_id').notNull(),
  reason: text('reason').notNull(),
  changedAt: utc('changed_at').notNull().defaultNow(),
}, t => [index('timecard_corrections_timecard_idx').on(t.timecardId)])

export const timecardExports = pgTable('timecard_exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  timecardId: uuid('timecard_id'),
  rangeStart: date('range_start'),
  rangeEnd: date('range_end'),
  generatedAt: utc('generated_at').notNull().defaultNow(),
  generatedByUserId: uuid('generated_by_user_id'),
  fileId: uuid('file_id'),
  /** Lets a printed copy be matched back to the stored record (spec 14.4). */
  verificationHash: text('verification_hash').notNull(),
}, t => [index('timecard_exports_company_idx').on(t.companyId, t.generatedAt)])

/* ============================================================
   Inferred types
   ============================================================ */

export type Company = typeof companies.$inferSelect
export type User = typeof users.$inferSelect
export type PhoneChallenge = typeof phoneChallenges.$inferSelect
export type CompanyMembership = typeof companyMemberships.$inferSelect
export type Driver = typeof drivers.$inferSelect
export type Truck = typeof trucks.$inferSelect
export type Location = typeof locations.$inferSelect
export type Container = typeof containers.$inferSelect
export type Chassis = typeof chassis.$inferSelect
export type Trip = typeof trips.$inferSelect
export type ContainerEvent = typeof containerEvents.$inferSelect
export type ContainerPlacement = typeof containerPlacements.$inferSelect
export type DocumentRecord = typeof documents.$inferSelect
export type OcrResult = typeof ocrResults.$inferSelect
export type DriverTimecard = typeof driverTimecards.$inferSelect
export type TimecardBreak = typeof timecardBreaks.$inferSelect
export type TimecardCorrection = typeof timecardCorrections.$inferSelect

export type NewContainer = typeof containers.$inferInsert
export type NewContainerEvent = typeof containerEvents.$inferInsert
export type NewTrip = typeof trips.$inferInsert
export type NewLocation = typeof locations.$inferInsert
export type NewDriverTimecard = typeof driverTimecards.$inferInsert
