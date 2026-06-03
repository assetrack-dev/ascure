# ASCURE BLUEPRINT V7

# Deployment & Infrastructure Blueprint

Version: 1.0

Purpose:

Document the complete deployment architecture of ASCURE.

This document must allow a new team to rebuild:

- Infrastructure
- Hosting
- Database
- API deployment
- Admin deployment
- Mobile release process
- Backup strategy
- Disaster recovery

without access to the original environment.

------------------------------------------------------------------------

# 1. Infrastructure Philosophy

ASCURE is designed for:

Operational simplicity

Low operational cost

Rapid deployment

Future scalability

------------------------------------------------------------------------

Initial deployment target:

20--100 active users

------------------------------------------------------------------------

Future target:

Nationwide deployment

Multiple contractors

Multiple regions

Thousands of assets

------------------------------------------------------------------------

# 2. Environment Types

Development

Local developer environment.

------------------------------------------------------------------------

Staging

Pre-production validation.

------------------------------------------------------------------------

Production

Live operational environment.

------------------------------------------------------------------------

# 3. Technology Stack

Backend

NestJS

Prisma

Node.js

------------------------------------------------------------------------

Database

PostgreSQL

------------------------------------------------------------------------

Admin Web

Next.js

TypeScript

------------------------------------------------------------------------

Mobile

React Native

Expo

Android

------------------------------------------------------------------------

Web Server

Nginx

------------------------------------------------------------------------

Process Manager

PM2

------------------------------------------------------------------------

Operating System

Ubuntu Server

------------------------------------------------------------------------

# 4. Production Architecture

Users

↓

Mobile App

↓

Internet

↓

Nginx

↓

API

↓

PostgreSQL

------------------------------------------------------------------------

Users

↓

Admin Web

↓

Nginx

↓

Next.js

↓

API

↓

PostgreSQL

------------------------------------------------------------------------

# 5. Initial Hosting Strategy

Single VPS

Purpose:

Reduce operational complexity.

------------------------------------------------------------------------

Components

Database

API

Admin Web

Nginx

PM2

------------------------------------------------------------------------

All hosted on one server.

------------------------------------------------------------------------

# 6. Recommended VPS Specification

Pilot

4 vCPU

8 GB RAM

100 GB SSD

------------------------------------------------------------------------

Growth

8 vCPU

16 GB RAM

200 GB SSD

------------------------------------------------------------------------

Enterprise

Dedicated database server

Object storage

Load balancing

------------------------------------------------------------------------

# 7. Operating System

Ubuntu LTS

Preferred version:

Current LTS release

------------------------------------------------------------------------

# 8. Domain Structure

Recommended

api.company-domain.com

admin.company-domain.com

------------------------------------------------------------------------

Examples

api.ascure.com.my

admin.ascure.com.my

------------------------------------------------------------------------

# 9. HTTPS

Mandatory.

------------------------------------------------------------------------

Provider

Let's Encrypt

------------------------------------------------------------------------

Renewal

Automatic

------------------------------------------------------------------------

# 10. Database

Engine

PostgreSQL

------------------------------------------------------------------------

Version

PostgreSQL 16

------------------------------------------------------------------------

Purpose

Single source of operational truth.

------------------------------------------------------------------------

# 11. Database Principles

No direct production edits.

All changes through:

Prisma Migration

Admin Interface

Approved scripts

------------------------------------------------------------------------

# 12. Prisma

ORM

Schema management

Migration management

------------------------------------------------------------------------

Typical Commands

prisma generate

prisma migrate deploy

prisma studio

------------------------------------------------------------------------

# 13. Backend Deployment

Application

NestJS

------------------------------------------------------------------------

Build

pnpm build

------------------------------------------------------------------------

Runtime

Node.js

------------------------------------------------------------------------

Process Manager

PM2

------------------------------------------------------------------------

PM2 Process

ascure-api

------------------------------------------------------------------------

# 14. Admin Web Deployment

Application

Next.js

------------------------------------------------------------------------

Build

next build

------------------------------------------------------------------------

Runtime

Next standalone

------------------------------------------------------------------------

Process Manager

PM2

------------------------------------------------------------------------

PM2 Process

ascure-admin

------------------------------------------------------------------------

# 15. Reverse Proxy

Nginx

------------------------------------------------------------------------

Responsibilities

HTTPS

Routing

Compression

Security Headers

------------------------------------------------------------------------

Routing Example

/api

↓

NestJS

------------------------------------------------------------------------

/

↓

Admin Web

------------------------------------------------------------------------

# 16. Environment Variables

Backend

DATABASE_URL

JWT_SECRET

JWT_REFRESH_SECRET

PORT

NODE_ENV

------------------------------------------------------------------------

Mobile

EXPO_PUBLIC_API_BASE_URL

------------------------------------------------------------------------

Admin

NEXT_PUBLIC_API_URL

------------------------------------------------------------------------

# 17. Production Build Procedure

Backend

Pull latest code

Install dependencies

Run migrations

Generate Prisma Client

Build

Restart PM2

------------------------------------------------------------------------

Admin

Pull latest code

Install dependencies

Build

Restart PM2

------------------------------------------------------------------------

# 18. Database Migration Procedure

Mandatory sequence:

Backup database

↓

Run migration

↓

Generate Prisma Client

↓

Build API

↓

Smoke test

------------------------------------------------------------------------

Never skip backup.

------------------------------------------------------------------------

# 19. Smoke Validation Checklist

API reachable

Admin reachable

Login works

MAINHEAD list loads

Site Visits load

Templates load

Defects load

Database connected

------------------------------------------------------------------------

# 20. Production Validation Checklist

Create Site Visit

Create Asset

Submit Inspection

Generate Defect

Verify Defect

Complete Maintenance

Close Defect

------------------------------------------------------------------------

All must pass.

------------------------------------------------------------------------

# 21. Mobile Build Strategy

Platform

Android

------------------------------------------------------------------------

Framework

Expo

------------------------------------------------------------------------

Build System

EAS Build

------------------------------------------------------------------------

Release Type

APK (pilot)

AAB (Play Store)

------------------------------------------------------------------------

# 22. Mobile Configuration

Environment Variable

EXPO_PUBLIC_API_BASE_URL

------------------------------------------------------------------------

Production Example

https://api.ascure.com.my/api/v1

------------------------------------------------------------------------

# 23. Mobile Release Procedure

Update version

Build APK/AAB

Upload

Install

Validate login

Validate inspection

Validate sync

------------------------------------------------------------------------

# 24. Offline Validation

Required before release.

------------------------------------------------------------------------

Create inspection offline

Capture photos

Create defects

Reconnect

Sync successfully

------------------------------------------------------------------------

# 25. Image Storage Strategy

Current

Local VPS storage

------------------------------------------------------------------------

Future

Cloudflare R2

AWS S3

MinIO

------------------------------------------------------------------------

Reason

Reduce VPS storage growth.

------------------------------------------------------------------------

# 26. Backup Strategy

Database Backup

Daily

------------------------------------------------------------------------

Retention

30 Days

------------------------------------------------------------------------

Storage

Separate backup location

------------------------------------------------------------------------

# 27. Disaster Recovery

Server Lost

↓

Provision new VPS

↓

Install dependencies

↓

Restore database

↓

Deploy API

↓

Deploy Admin

↓

Update DNS

↓

Validate operations

------------------------------------------------------------------------

# 28. Monitoring

Current

PM2

System logs

------------------------------------------------------------------------

Future

Grafana

Prometheus

Uptime monitoring

------------------------------------------------------------------------

# 29. Security Practices

HTTPS mandatory

Strong JWT secrets

Limited SSH access

Firewall enabled

Fail2Ban recommended

------------------------------------------------------------------------

# 30. Production Users

Current operational users

ADMIN

QA

Managers

Technicians

Maintenance

------------------------------------------------------------------------

# 31. Deployment Governance

Production changes require:

Migration review

Backup

Smoke validation

Operational validation

------------------------------------------------------------------------

# 32. Future Scaling Strategy

Phase 1

Single VPS

------------------------------------------------------------------------

Phase 2

Dedicated database

Object storage

------------------------------------------------------------------------

Phase 3

Load balancer

Multiple API instances

CDN

------------------------------------------------------------------------

# 33. Future Services

Notification Service

Reporting Service

AI Validation Service

Analytics Service

------------------------------------------------------------------------

# 34. Infrastructure Principles

Operational stability first.

Feature delivery second.

------------------------------------------------------------------------

Data loss is unacceptable.

------------------------------------------------------------------------

Operational truth must survive infrastructure failures.

------------------------------------------------------------------------

# 35. Disaster Recovery Goal

Target:

Rebuild complete production environment within one working day using:

Source Code

Database Backup

ASCURE Blueprints

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V7
