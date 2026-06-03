# ASCURE BLUEPRINT V2

## Technical Architecture & Operational Specification

------------------------------------------------------------------------

# 23. Platform Architecture

ASCURE consists of three primary applications:

1.  API Backend
2.  Admin Web
3.  Mobile Application

All applications share a common PostgreSQL database.

------------------------------------------------------------------------

Architecture Diagram

Mobile App ↓ NestJS API ↓ PostgreSQL

Admin Web ↓ NestJS API ↓ PostgreSQL

------------------------------------------------------------------------

Future Services

Notification Service

Report Generator

Object Storage

AI Validation Engine

Analytics Engine

------------------------------------------------------------------------

# 24. Technology Stack

Backend

NestJS

Prisma ORM

PostgreSQL

JWT Authentication

REST API

------------------------------------------------------------------------

Admin Web

Next.js

TypeScript

Tailwind

React Query

------------------------------------------------------------------------

Mobile

React Native

Expo

TypeScript

AsyncStorage

NetInfo

Expo Camera

Expo Location

ViewShot

------------------------------------------------------------------------

Infrastructure

Ubuntu VPS

PM2

Nginx

HTTPS

PostgreSQL 16

------------------------------------------------------------------------

# 25. Multi-Tenant Design

ASCURE supports multiple organizations.

Each organization represents a company.

Examples:

ASCURA

ABC Engineering

XYZ Maintenance

Contractor A

Contractor B

------------------------------------------------------------------------

Every operational record belongs to:

Tenant

Organization

or both

depending on operational scope.

------------------------------------------------------------------------

# 26. Operational Access Model

Access is not based solely on organization.

Access is determined by:

Role

Organization

Branch

Team

MAINHEAD

Operational Region

------------------------------------------------------------------------

User Visibility Sources

Legacy MAINHEAD

user.mainheadId

------------------------------------------------------------------------

Direct Access

UserMainheadAccess

------------------------------------------------------------------------

Regional Access

UserOperationalRegionAccess

------------------------------------------------------------------------

Inherited Access

Branch

Team

------------------------------------------------------------------------

Administrative Access

ADMIN

ASCURA QA

------------------------------------------------------------------------

# 27. Core Database Entities

Tenant

Organization

Branch

OperationalRegion

MAINHEAD

Project

WorkPackage

Team

User

SiteVisit

Asset

Inspection

Defect

InspectionTemplate

InspectionTemplateVersion

ChecklistItem

InspectionResponse

DefectEvidenceImage

TimelineEvent

AuditLog

------------------------------------------------------------------------

# 28. Organization Structure

Organization

Fields:

id

name

code

type

status

createdAt

updatedAt

------------------------------------------------------------------------

Types

UTILITY_OWNER

INSPECTION_CONTRACTOR

MAINTENANCE_CONTRACTOR

GOVERNANCE

------------------------------------------------------------------------

# 29. Operational Region

Represents TNB operational region.

Examples

Klang Valley

Johor

Pahang

Perak

Melaka

------------------------------------------------------------------------

Fields

id

name

code

status

------------------------------------------------------------------------

# 30. MAINHEAD

Represents operational area.

Examples

KL Timur

KL Barat

Langat

Klang

Subang

Bentong

------------------------------------------------------------------------

Fields

id

name

code

operationalRegionId

status

------------------------------------------------------------------------

# 31. Team Model

Team belongs to organization.

Team may perform:

Inspection

Maintenance

or both

------------------------------------------------------------------------

Fields

id

name

organizationId

status

------------------------------------------------------------------------

# 32. Site Visit Model

Represents operational field session.

Examples

SAVR Inspection

Pencawang Inspection

Maintenance Visit

------------------------------------------------------------------------

Fields

id

visitNumber

mainheadId

projectId

workPackageId

status

startedAt

completedAt

createdBy

------------------------------------------------------------------------

Statuses

OPEN

IN_PROGRESS

COMPLETED

CANCELLED

ACTIVE (legacy)

------------------------------------------------------------------------

# 33. Asset Model

Represents physical utility asset.

Examples

Pole

Substation

Feeder Pillar

Link Box

Cable Bridge

------------------------------------------------------------------------

Fields

id

assetType

assetCode

assetName

latitude

longitude

operationalStatus

substationId

------------------------------------------------------------------------

Operational Status

EXISTING

NEW

NOT_FOUND

DEMOLISHED

------------------------------------------------------------------------

Uniqueness Rule

tenantId

substationId

assetCode

must be unique

------------------------------------------------------------------------

# 34. Inspection Model

Represents completed checklist.

Fields

id

assetId

templateVersionId

submittedBy

submittedAt

status

remarks

------------------------------------------------------------------------

Statuses

DRAFT

SUBMITTED

APPROVED

REJECTED

------------------------------------------------------------------------

# 35. Defect Model

Represents operational defect.

Generated from inspections.

------------------------------------------------------------------------

Fields

id

assetId

inspectionId

severity

description

status

verifiedBy

assignedTeamId

------------------------------------------------------------------------

# 36. Defect Lifecycle

State Machine

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

# 37. Timeline Engine

Every operational action generates timeline records.

Examples

Inspection Submitted

Defect Verified

Defect Assigned

Maintenance Started

Maintenance Completed

Closure Approved

------------------------------------------------------------------------

Timeline Events

STATUS_CHANGED

DEFECT_VERIFIED

DEFECT_REJECTED

DEFECT_ASSIGNED

MAINTENANCE_STARTED

MAINTENANCE_COMPLETED

CLOSURE_VERIFIED

------------------------------------------------------------------------

# 38. Inspection Templates

Templates are dynamic.

No hardcoded inspection forms.

------------------------------------------------------------------------

Supported Fields

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

# 39. Conditional Logic

Checklist Builder V2

Supports:

showIf

Example

Broken Insulator = YES

Then show:

Severity

Image

Quantity

------------------------------------------------------------------------

# 40. Template Governance

Template Status

DRAFT

ACTIVE

ARCHIVED

------------------------------------------------------------------------

Template Scope

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

# 41. Mobile Offline Architecture

Mobile operates offline-first.

All actions are queued.

------------------------------------------------------------------------

Queues

Inspection Queue

Photo Queue

Visit Completion Queue

Maintenance Queue

------------------------------------------------------------------------

Sync Order

Inspection Data

↓

Photos

↓

Defects

↓

Visit Completion

------------------------------------------------------------------------

Retry supported.

------------------------------------------------------------------------

# 42. GPS Evidence

All inspections support GPS capture.

Stored:

Latitude

Longitude

Accuracy

Timestamp

------------------------------------------------------------------------

# 43. Photo Evidence

Captured through mobile camera.

Supports:

Timestamp Overlay

GPS Overlay

Multiple Images

Preview Before Upload

------------------------------------------------------------------------

Future

Watermark Verification

Tamper Detection

------------------------------------------------------------------------

# 44. QA/QC Governance

QA belongs to ASCURA.

Not contractor.

Not utility owner.

------------------------------------------------------------------------

Responsibilities

Review inspections

Approve inspections

Reject inspections

Verify defects

Close defects

Audit records

------------------------------------------------------------------------

# 45. Maintenance Workflow

Verified defect

↓

Assigned

↓

Repair Performed

↓

Evidence Uploaded

↓

Completed

↓

QA Verification

↓

Closed

------------------------------------------------------------------------

Multiple evidence images supported.

------------------------------------------------------------------------

# 46. Reporting Architecture

Current

Excel Export

Per Pencawang

Per Site Visit

------------------------------------------------------------------------

Future

PDF Reports

Visual Reports

Executive Dashboards

Operational Heatmaps

------------------------------------------------------------------------

# 47. Audit Requirements

Every critical action logged.

Includes:

User

Timestamp

Action

Entity

Old Value

New Value

------------------------------------------------------------------------

Required for:

Inspection

Approval

Assignment

Maintenance

Closure

Configuration Changes

------------------------------------------------------------------------

# 48. Notification Roadmap

Future Service

Push Notifications

Email Notifications

In-App Notifications

------------------------------------------------------------------------

Events

Defect Assigned

Inspection Rejected

Maintenance Completed

Closure Approved

------------------------------------------------------------------------

# 49. AI Roadmap

Future Modules

Checklist Validation

Image Quality Validation

Duplicate Asset Detection

GPS Validation

Defect Classification

Report Generation

------------------------------------------------------------------------

# 50. Operational Pilot Validation

Target Validation Scenario

Check-In

↓

Create 10 SAVR Assets

↓

Inspect Assets

↓

Generate Defects

↓

QA Review

↓

Maintenance Assignment

↓

Repair Completion

↓

QA Closure

------------------------------------------------------------------------

Success Criteria

No workflow dead ends

No permission leaks

No data loss

No sync failures

Complete audit trail

Complete evidence preservation

Governance rules enforced

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V2
