# ASCURE BLUEPRINT V10

# MASTER REBUILD PROMPT

Version: 1.0

Purpose:

This document is the definitive reconstruction specification for ASCURE.

A competent engineering team or AI coding system should be able to
rebuild ASCURE from this document even if all source code,
infrastructure, and databases are lost.

------------------------------------------------------------------------

# SYSTEM NAME

ASCURE

Asset Survey, Compliance, Utility Reporting & Execution

Owned by:

ASCURA

------------------------------------------------------------------------

# SYSTEM PURPOSE

ASCURE is an operational governance platform designed for utility
inspection, defect management, maintenance coordination, QA/QC
verification, operational reporting, and evidence preservation.

The platform was initially designed around Tenaga Nasional Berhad (TNB)
operational workflows but must remain configurable for future utility
clients.

ASCURE is not a data collection application.

ASCURE is a governance platform whose purpose is to preserve operational
truth from inspection through maintenance closure.

------------------------------------------------------------------------

# CORE PRINCIPLES

1.  Flexible Operations

Different regions may have different templates and requirements.

------------------------------------------------------------------------

2.  Centralized Operational Truth

Operational records must remain consistent.

------------------------------------------------------------------------

3.  Localized Governance

Rules may vary by MAINHEAD.

------------------------------------------------------------------------

4.  Evidence Preservation

Photos, GPS, timestamps, and operational history must be preserved.

------------------------------------------------------------------------

5.  Offline First

Field operations must function without internet connectivity.

------------------------------------------------------------------------

# TECHNOLOGY STACK

Backend

NestJS

Prisma ORM

PostgreSQL

REST API

JWT Authentication

------------------------------------------------------------------------

Admin Web

Next.js

TypeScript

Tailwind

------------------------------------------------------------------------

Mobile

React Native

Expo

TypeScript

------------------------------------------------------------------------

Infrastructure

Ubuntu

Nginx

PM2

PostgreSQL

HTTPS

------------------------------------------------------------------------

# HIGH LEVEL ARCHITECTURE

Mobile

↓

API

↓

PostgreSQL

------------------------------------------------------------------------

Admin Web

↓

API

↓

PostgreSQL

------------------------------------------------------------------------

Future Services

Notification Engine

AI Validation

Reporting Engine

Analytics Engine

Object Storage

------------------------------------------------------------------------

# ORGANIZATIONAL MODEL

Tenant

↓

Organization

↓

Branch

↓

Operational Region

↓

MAINHEAD

↓

Project

↓

Work Package

↓

Site Visit

↓

Asset

↓

Inspection

↓

Defect

------------------------------------------------------------------------

# ORGANIZATION TYPES

GOVERNANCE

UTILITY_OWNER

INSPECTION_CONTRACTOR

MAINTENANCE_CONTRACTOR

GENERAL

------------------------------------------------------------------------

# GOVERNANCE G1

Implemented and mandatory.

------------------------------------------------------------------------

OperationalRegion exists.

------------------------------------------------------------------------

Users may access:

Single MAINHEAD

Multiple MAINHEADs

Entire Regions

Multiple Regions

------------------------------------------------------------------------

Contractors are not permanently attached to MAINHEADs.

------------------------------------------------------------------------

MAINHEAD ownership is independent from contractor ownership.

------------------------------------------------------------------------

# MAINHEAD VISIBILITY ALGORITHM

GET /users/me/mainheads

Resolution order:

1.  UserMainheadAccess

2.  UserOperationalRegionAccess

3.  Team inheritance

4.  Branch inheritance

5.  Legacy user.mainheadId

6.  ADMIN override

7.  ASCURA QA override

------------------------------------------------------------------------

# TEMPLATE GOVERNANCE

Templates are dynamic.

Templates are never hardcoded.

------------------------------------------------------------------------

Supported Scopes

GLOBAL

ORGANIZATION

BRANCH

OPERATIONAL_REGION

MAINHEAD

------------------------------------------------------------------------

Resolution Order

MAINHEAD

↓

OPERATIONAL_REGION

↓

BRANCH

↓

ORGANIZATION

↓

GLOBAL

------------------------------------------------------------------------

Most specific active template wins.

------------------------------------------------------------------------

# CHECKLIST BUILDER V2

Supported Types

TEXT

NUMBER

YES_NO

DROPDOWN

MULTI_SELECT

IMAGE

GPS

DATE

DATETIME

READING

OCR

------------------------------------------------------------------------

Features

Required Fields

Conditional Logic

showIf

Versioning

Scope Assignment

Image Rules

------------------------------------------------------------------------

# MOBILE WORKSPACES

Inspection

Maintenance

------------------------------------------------------------------------

Single workspace users automatically enter their workspace.

------------------------------------------------------------------------

# INSPECTION WORKSPACE

Displays

In Progress

Completed

Need Amendment

------------------------------------------------------------------------

Approved inspections hidden from technician queue.

------------------------------------------------------------------------

# MAINTENANCE WORKSPACE

Displays

Assigned

In Progress

Completed

Verification Pending

------------------------------------------------------------------------

# SITE VISIT

Operational session container.

Contains:

Assets

Inspections

Defects

Evidence

Participants

------------------------------------------------------------------------

Statuses

OPEN

IN_PROGRESS

COMPLETED

CANCELLED

ACTIVE (legacy)

------------------------------------------------------------------------

# SITE VISIT RULES

Must contain assets.

Cannot complete with pending submissions.

Cannot complete with unsynced inspections.

------------------------------------------------------------------------

# ASSET MODEL

Asset Types

SAVR

SAVT

PENCAWANG

FEEDER_PILLAR

LINK_BOX

CABLE_BRIDGE

UNDERGROUND_CABLE

THERMAL_INSPECTION

------------------------------------------------------------------------

Operational Status

EXISTING

NEW

NOT_FOUND

DEMOLISHED

------------------------------------------------------------------------

Asset Uniqueness

tenantId

substationId

assetCode

------------------------------------------------------------------------

# INSPECTION MODEL

Statuses

DRAFT

SUBMITTED

APPROVED

REJECTED

------------------------------------------------------------------------

Inspection responses stored dynamically.

------------------------------------------------------------------------

# DEFECT MODEL

Defects generated from inspections.

Must link:

Asset

Inspection

Site Visit

------------------------------------------------------------------------

# DEFECT LIFECYCLE

DETECTED

↓

UNDER_REVIEW

↓

VERIFIED

↓

ASSIGNED

↓

IN_PROGRESS

↓

COMPLETED

↓

VERIFICATION_PENDING

↓

CLOSED

------------------------------------------------------------------------

Invalid transitions blocked.

------------------------------------------------------------------------

# RESOLUTION OUTCOMES

RESOLVED

TEMPORARY_FIX

MONITORING_REQUIRED

EXTERNAL_CONSTRAINT

DEFERRED

------------------------------------------------------------------------

# GOVERNANCE RULES

QA belongs to ASCURA.

------------------------------------------------------------------------

Only QA may:

Verify defects

Reject defects

Approve closures

Reject closures

Close defects

------------------------------------------------------------------------

Managers cannot override QA.

Technicians cannot close defects.

Maintenance cannot verify defects.

------------------------------------------------------------------------

# EVIDENCE RULES

Inspection evidence required.

Maintenance evidence required.

------------------------------------------------------------------------

Evidence supports:

Photos

GPS

Timestamp

Notes

------------------------------------------------------------------------

Evidence must never be overwritten.

------------------------------------------------------------------------

# AUDIT RULES

Audit logging mandatory.

------------------------------------------------------------------------

Capture

User

Timestamp

Entity

Old Value

New Value

Action

------------------------------------------------------------------------

Audit logs immutable.

------------------------------------------------------------------------

# TIMELINE EVENTS

STATUS_CHANGED

DEFECT_VERIFIED

DEFECT_REJECTED

DEFECT_ASSIGNED

MAINTENANCE_STARTED

MAINTENANCE_COMPLETED

CLOSURE_VERIFIED

------------------------------------------------------------------------

Generated automatically.

------------------------------------------------------------------------

# OFFLINE ARCHITECTURE

Offline-first.

------------------------------------------------------------------------

Queues

Inspection Queue

Photo Queue

Visit Completion Queue

Maintenance Queue

------------------------------------------------------------------------

Sync Order

Inspection

↓

Photos

↓

Defects

↓

Visit Completion

------------------------------------------------------------------------

# GPS REQUIREMENTS

Capture:

Latitude

Longitude

Accuracy

Timestamp

------------------------------------------------------------------------

Used for:

Check-In

Assets

Inspections

Maintenance Evidence

------------------------------------------------------------------------

# PHOTO REQUIREMENTS

Timestamp Overlay

GPS Overlay

Preview Before Upload

Offline Support

Retry Upload

------------------------------------------------------------------------

# USER ROLES

ADMIN

VIEWER

CLIENT

------------------------------------------------------------------------

Operational Personas

QA Supervisor

QA Inspector

Manager

Team Leader

Technician

Maintenance Technician

------------------------------------------------------------------------

# PERMISSION RULES

ADMIN

Full Access

------------------------------------------------------------------------

QA

Cross-region visibility

Cross-mainhead visibility

Verification authority

Closure authority

------------------------------------------------------------------------

Manager

Assignment authority

Reporting authority

Operational management

------------------------------------------------------------------------

Technician

Operational execution only

------------------------------------------------------------------------

Maintenance

Repair execution only

------------------------------------------------------------------------

# ADMIN WEB MODULES

Dashboard

Users

Organizations

Branches

Operational Regions

MAINHEADs

Projects

Work Packages

Teams

Templates

Site Visits

Defects

Operations Board

------------------------------------------------------------------------

# MOBILE SCREENS

Login

Workspace Selection

Inspection Workspace

Site Visit List

Site Visit Detail

Check-In

Add Asset

Asset Detail

Inspection Form

Defect Detail

Maintenance Workspace

Maintenance Detail

Sync Queue

Settings

------------------------------------------------------------------------

# SAVR DOMAIN

Primary operational domain.

------------------------------------------------------------------------

Operational Flow

AMK

↓

Site Visit

↓

Asset Registration

↓

Inspection

↓

Defect Detection

↓

QA Verification

↓

Maintenance

↓

Closure

------------------------------------------------------------------------

Pencawang groups poles.

Each pole is independent.

------------------------------------------------------------------------

Fields

NO TIANG RONDAAN

NO TIANG LAMA

GPS

Operational Status

Evidence

------------------------------------------------------------------------

# REPORTING

Current

Excel Export

Per Pencawang

Per Site Visit

------------------------------------------------------------------------

Future

Visual Reports

PDF Reports

Dashboards

Heatmaps

------------------------------------------------------------------------

# DEPLOYMENT

Ubuntu VPS

PM2

Nginx

PostgreSQL

HTTPS

------------------------------------------------------------------------

Recommended Pilot VPS

4 vCPU

8 GB RAM

100 GB SSD

------------------------------------------------------------------------

# BACKUP STRATEGY

Daily PostgreSQL backups.

Retention:

30 days minimum.

------------------------------------------------------------------------

# DISASTER RECOVERY

Provision VPS

Restore database

Deploy API

Deploy Admin

Configure Nginx

Restore DNS

Validate workflows

------------------------------------------------------------------------

# SUCCESS CRITERIA

A rebuilt ASCURE system must support:

Multi-company operations

Multi-region governance

Multi-MAINHEAD access

Dynamic templates

Offline inspections

Defect lifecycle management

QA verification

Maintenance workflows

Closure approval

Audit logging

Evidence preservation

Operational reporting

SAVR pilot execution

------------------------------------------------------------------------

# ASCURE MISSION

ASCURE exists to provide a trusted operational truth layer between field
execution, governance, maintenance, and reporting.

Every feature, workflow, database structure, API endpoint, and UI
decision must support that mission.

END OF MASTER REBUILD PROMPT
