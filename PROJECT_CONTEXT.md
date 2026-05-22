## Project Overview

ASCURE is an enterprise asset inspection, operational monitoring, and defect management platform designed primarily for utility infrastructure workflows, especially for TNB operational environments in Malaysia.

The platform supports:
- Field asset inspections
- Site visit operational workflows
- Defect lifecycle management
- Dynamic checklist rendering
- GPS + timestamped image capture
- Offline-first mobile operations
- GIS-ready asset mapping
- Operational dashboards and validation workflows

The system is designed to support large-scale operational data collection and future AI-assisted validation/reporting workflows.

---

# Architecture

## Monorepo Structure

ASCURE uses a PNPM workspace monorepo structure.

Main directories:

apps/
api/ → NestJS backend API
admin-web/ → Next.js admin portal
mobile/ → Expo React Native mobile app

packages/
shared/ → Shared types/utilities (future expansion)


---

# Technology Stack

## Backend API
- NestJS
- Prisma ORM
- PostgreSQL
- JWT Authentication
- TypeScript

Responsibilities:
- Authentication & RBAC
- Inspection APIs
- Defect workflows
- Site visit operations
- Image uploads
- Sync coordination
- Operational validation
- Dashboard metrics

---

## Admin Web
- Next.js
- React
- TypeScript
- Tailwind CSS

Responsibilities:
- Operational dashboards
- User management
- Inspection template builder
- Defect management
- Site visit monitoring
- Validation workflows
- Administrative controls

UI Direction:
- Industrial minimal
- Compact enterprise operational UI
- Dark slate + cyan accent styling

---

## Mobile App
- Expo
- React Native
- TypeScript

Core Features:
- Offline-first inspection workflows
- GPS/location capture
- Timestamped image overlays
- Dynamic inspection forms
- Sync queue & retry system
- Asset mapping
- Defect reporting
- Site visit workflows

Mobile workflow is designed for operational simplicity and unreliable field connectivity.

---

# Deployment Architecture

## Current Production Environment

Infrastructure:
- Ubuntu VPS
- Nginx reverse proxy
- PM2 process management
- Docker / Docker Compose
- PostgreSQL
- HTTPS (Let's Encrypt)

Domains:
- https://api.ascure.com.my
- https://admin.ascure.com.my

---

# Core Functional Modules

## Authentication & RBAC
Roles:
- ADMIN
- VIEWER
- CLIENT

Features:
- JWT authentication
- Role-based permissions
- Secure password hashing
- Last-admin protection logic

---

## Dynamic Checklist Builder
Admin users can:
- Create inspection templates
- Reorder checklist items
- Duplicate templates
- Archive templates safely
- Version templates

Mobile app dynamically renders inspection forms from active templates.

---

## Inspection System
Features:
- Dynamic form rendering
- Required field validation
- Defect trigger logic
- Inspection history
- Latest inspection retrieval
- Inspection image uploads

Images are stored using:
uploads/inspections/{inspectionId}/{filename}

---

## Defect Workflow System

Features:
- Severity management
- Assignment workflows
- Timeline/history tracking
- SLA tracking
- Monitoring states

Statuses include:
- OPEN
- IN_PROGRESS
- MONITORING
- RESOLVED
- CLOSED

---

## Site Visit Operational Workflow

Operational states:
- OPEN
- IN_PROGRESS
- COMPLETED
- CANCELLED

Features:
- Team operational workflows
- Asset linking
- Rollup metrics
- Completion validation
- Operational dashboards
- GIS-ready data hooks

Completion validation:
- Cannot complete without linked assets
- Cannot complete with pending operational issues

---

## Offline Sync System

Features:
- Persistent sync queue
- Automatic retry
- Reconnect detection
- Upload replay ordering
- Unsynced inspection protection

Replay order:
1. Save inspection results
2. Upload images
3. Submit inspection

---

## Mapping & GIS

Features:
- Satellite map mode
- Asset markers
- Marker clustering
- Feeder visualization
- Long-press asset creation
- Current location support
- GIS integration preparation

Future expansion planned for:
- Advanced GIS analytics
- Feeder tracing
- Operational spatial intelligence

---

# Current Development Focus

Current priorities:

1. Operational workflow refinement
2. Offline sync hardening
3. GIS & mapping improvements
4. AI validation engine
5. Deployment hardening & scalability

Deferred priorities:
- Reporting engine
- Automated PDF generation
- Advanced analytics exports

---

# AI Validation Vision

Planned AI-assisted validation includes:
- Asset numbering validation
- Feeder sequence checking
- Operational anomaly detection
- Data completeness checks
- Site completion validation
- Intelligent reporting assistance

---

# Recent Major Development Milestones

## Recent Work Summary

### Operational Workflow Improvements
- Simplified maintenance completion flow
- Backend-safe lifecycle auto-transition:
  VERIFIED → ASSIGNED → IN_PROGRESS → COMPLETED

### Offline Sync Improvements
- Retry Sync UX
- Queue reliability enhancements
- Upload persistence improvements

### UI/UX Refinement
- Compact operational dashboard improvements
- Mobile sync queue improvements
- Industrial operational design refinement

### Deployment Progress
- VPS production deployment completed
- Nginx + PM2 operational
- Docker production builds operational
- Android EAS builds operational

---

# Future Technical Direction

## Planned Enhancements
- Object storage migration (S3 / R2 / MinIO)
- Enterprise reporting engine
- AI operational validation
- Advanced GIS visualization
- Multi-tenant readiness
- Real-time operational monitoring
- Push notifications
- Websocket operational updates

---

# Branding

Product:
- ASCURE

Company:
- ASCURA

Brand Direction:
- Minimalist
- Modern enterprise technology
- Operational reliability
- Industrial-tech aesthetic

Preferred palette:
- Deep slate
- Cyan accent
- Clean white backgrounds