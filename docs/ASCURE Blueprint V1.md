# ASCURE BLUEPRINT V1

## Asset Survey, Compliance, Utility Reporting & Execution

Version: 1.0\
Status: Operational Pilot Ready\
Owner: ASCURA\
Platform: ASCURE

------------------------------------------------------------------------

# 1. Executive Summary

ASCURE is an operational governance platform designed for utility asset
inspection, defect management, maintenance coordination, QA/QC
verification, and operational reporting.

The platform was originally designed to support Tenaga Nasional Berhad
(TNB) field operations but is architected to support multiple
organizations, contractors, operational regions, and inspection
programs.

ASCURE is not merely a data collection application.

ASCURE acts as the operational source of truth between:

- Asset Inspection Teams
- Maintenance Teams
- QA/QC Teams
- Operational Managers
- Utility Asset Owners

Core objective:

Provide a complete lifecycle from field inspection through maintenance
closure while preserving operational evidence and governance.

------------------------------------------------------------------------

# 2. Core Philosophy

ASCURE is built on five principles.

## Flexible Operations

Different operational areas may have different inspection requirements.

Templates and workflows must be configurable.

------------------------------------------------------------------------

## Centralized Operational Truth

Regardless of contractor, team, or region, operational records must
remain consistent.

------------------------------------------------------------------------

## Localized Governance

Different MAINHEADs may have different requirements.

ASCURE supports governance at:

- Global
- Organization
- Branch
- Operational Region
- MAINHEAD

------------------------------------------------------------------------

## Operational Evidence Preservation

All operational activities must be supported by evidence.

Examples:

- Photos
- GPS
- Timestamps
- Inspection Records
- Maintenance Records

------------------------------------------------------------------------

## Offline First

Field operations must continue even without connectivity.

------------------------------------------------------------------------

# 3. Business Structure

## ASCURA

ASCURA is the platform owner.

Responsibilities:

- Governance
- QA/QC
- Audit
- Verification

ASCURA does not represent TNB.

ASCURA acts as an operational governance organization.

------------------------------------------------------------------------

## Utility Owner

Example:

TNB

Responsibilities:

- Issue work
- Monitor progress
- Review reports

------------------------------------------------------------------------

## Inspection Contractors

Responsibilities:

- Asset inspection
- Defect identification
- Evidence collection

------------------------------------------------------------------------

## Maintenance Contractors

Responsibilities:

- Defect rectification
- Repair evidence submission

------------------------------------------------------------------------

# 4. Operational Hierarchy

Organization (Company) → Branch → Operational Region → MAINHEAD →
Project → Work Package → Site Visit → Asset → Inspection → Defect

------------------------------------------------------------------------

# 5. Governance G1

Implemented and Production Ready.

## Operational Region

Represents TNB operational regions.

Examples:

- Klang Valley
- Pahang
- Johor

------------------------------------------------------------------------

## MAINHEAD

Represents operational areas.

Examples:

- KL Timur
- KL Barat
- Klang
- Langat
- Subang

------------------------------------------------------------------------

## Access Model

Users may access:

- One MAINHEAD
- Multiple MAINHEADs
- One Region
- Multiple Regions

------------------------------------------------------------------------

## Access Sources

Legacy Access

user.mainheadId

Direct Access

UserMainheadAccess

Region Access

UserOperationalRegionAccess

Fallback Access

Team Branch

Administrative Access

ADMIN

ASCURA QA

Can access all active MAINHEADs.

------------------------------------------------------------------------

# 6. Supported Operational Domains

## SAVR

Sesalur Atas Voltan Rendah

Pole based inspections.

------------------------------------------------------------------------

## SAVT

Route based inspections.

Pencawang A → Route → Pencawang B

------------------------------------------------------------------------

## Pencawang

Substation inspections.

------------------------------------------------------------------------

## Feeder Pillar

------------------------------------------------------------------------

## Link Box

------------------------------------------------------------------------

## Cable Bridge

------------------------------------------------------------------------

## Underground Cable

------------------------------------------------------------------------

## Thermal Inspection

------------------------------------------------------------------------

## Maintenance

Defect rectification workflow.

------------------------------------------------------------------------

# 7. User Roles

Global Roles:

ADMIN

VIEWER

CLIENT

------------------------------------------------------------------------

Operational Users:

Manager

Team Leader

Technician

QA Inspector

QA Supervisor

------------------------------------------------------------------------

# 8. Inspection Workflow

Check-In

↓

Create Asset

↓

Capture GPS

↓

Inspection

↓

Checklist Completion

↓

Photo Evidence

↓

Defect Detection

↓

Submit

↓

QA Review

------------------------------------------------------------------------

# 9. Defect Lifecycle

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

Rules:

Only QA may verify.

Only VERIFIED defects may be assigned.

Only QA may close defects.

------------------------------------------------------------------------

# 10. Resolution Outcomes

RESOLVED

TEMPORARY_FIX

MONITORING_REQUIRED

EXTERNAL_CONSTRAINT

DEFERRED

------------------------------------------------------------------------

# 11. Checklist Builder V2

Supported Field Types:

Text

Number

Yes/No

Dropdown

Multi Select

Image

GPS

Date

DateTime

Reading/Measurement

OCR Placeholder

------------------------------------------------------------------------

Capabilities:

Required Fields

Conditional Logic

showIf

Versioning

Template Cloning

Scope Assignment

------------------------------------------------------------------------

# 12. Template Scope Hierarchy

Highest Priority:

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

# 13. Mobile Application

Platform:

React Native

Expo

Android First

------------------------------------------------------------------------

Workspaces

Inspection

Maintenance

------------------------------------------------------------------------

Inspection Workspace

In Progress

Completed

Need Amendment

Approved Hidden

------------------------------------------------------------------------

Maintenance Workspace

Defect Queue

Assignment Queue

Completion Queue

------------------------------------------------------------------------

Offline Features

Local Queue

Photo Queue

Visit Completion Queue

GPS Capture

Timestamp Overlay

Sync Retry

------------------------------------------------------------------------

# 14. Asset Management

Asset Status

Existing

New

Not Found

Demolished

------------------------------------------------------------------------

SAVR Naming

Asset Code

NO TIANG RONDAAN

Asset Name

NO TIANG LAMA

------------------------------------------------------------------------

Uniqueness

tenantId

- substationId

- assetCode

------------------------------------------------------------------------

# 15. Site Visits

Statuses:

OPEN

IN_PROGRESS

COMPLETED

CANCELLED

Legacy ACTIVE retained for compatibility.

------------------------------------------------------------------------

Completion Rules

At least one linked asset.

No pending inspection submissions.

------------------------------------------------------------------------

# 16. Defect Management

Verified defects become maintenance-ready.

Maintenance teams may upload:

Multiple images

Timestamp evidence

Repair notes

Completion notes

------------------------------------------------------------------------

# 17. Reporting

Current Requirements

SAVR Excel Export

Per Pencawang

------------------------------------------------------------------------

Visual Reports

Asset Based

Inspection Based

Evidence Included

------------------------------------------------------------------------

Future

PDF Reports

Automated Reports

Operational Dashboards

------------------------------------------------------------------------

# 18. Security Model

Access controlled by:

Organization

Branch

Team

MAINHEAD

Operational Region

------------------------------------------------------------------------

Audit logging required for:

Inspection

Approval

Defect Changes

Assignments

Maintenance Actions

Closures

------------------------------------------------------------------------

# 19. Deployment Architecture

Backend

NestJS

Prisma

PostgreSQL

------------------------------------------------------------------------

Admin Web

Next.js

TypeScript

------------------------------------------------------------------------

Mobile

React Native

Expo

------------------------------------------------------------------------

Infrastructure

Ubuntu VPS

PM2

Nginx

HTTPS

PostgreSQL

------------------------------------------------------------------------

# 20. Current Production Status

Governance G1 Completed.

Production Deployed.

Smoke Validation Passed.

Mobile Operational.

Admin Operational.

Template Builder V2 Operational.

Multi-MAINHEAD Access Operational.

Operational Region Governance Operational.

Ready for Real-World Pilot Validation.

------------------------------------------------------------------------

# 21. Immediate Next Objectives

1.  Create Real Operational Structure

Regions

MAINHEADs

Organizations

Teams

Users

------------------------------------------------------------------------

2.  Build Production SAVR Template

------------------------------------------------------------------------

3.  Execute Full Pilot

Check-In

Asset Creation

Inspection

Defect

QA Review

Maintenance

Closure

------------------------------------------------------------------------

4.  Conduct Gap Analysis

Operational

Technical

Reporting

Governance

------------------------------------------------------------------------

# 22. Long-Term Vision

Become the operational governance platform for utility asset inspection
and maintenance across multiple regions, contractors, and asset classes.

ASCURE must serve as the authoritative operational truth layer between
field execution and management reporting while remaining flexible enough
to accommodate local operational practices.
