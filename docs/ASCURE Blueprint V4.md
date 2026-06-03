# ASCURE BLUEPRINT V4

# Data Model & Operational Schema Specification

Version: 1.0

------------------------------------------------------------------------

# 1. Purpose

This document defines the logical data architecture of ASCURE.

It is intended to allow complete reconstruction of:

- Database
- Prisma Schema
- Entity Relationships
- Business Rules
- Access Control

This document describes logical structure, not implementation syntax.

------------------------------------------------------------------------

# 2. Core Design Principles

ASCURE is:

- Multi-tenant
- Multi-company
- Multi-region
- Multi-MAINHEAD
- Offline-capable
- Governance-driven

The database must preserve:

Operational Truth

Auditability

Evidence

Workflow Integrity

------------------------------------------------------------------------

# 3. Tenant

Represents top-level ownership.

Future-proofing entity.

------------------------------------------------------------------------

Fields

id

name

code

status

createdAt

updatedAt

------------------------------------------------------------------------

Relationships

Tenant

→ Organizations

→ Users

→ Projects

→ Assets

------------------------------------------------------------------------

# 4. Organization

Represents company.

Examples:

ASCURA

Inspection Contractor

Maintenance Contractor

TNB

------------------------------------------------------------------------

Fields

id

tenantId

name

code

type

status

createdAt

updatedAt

------------------------------------------------------------------------

Organization Types

GOVERNANCE

UTILITY_OWNER

INSPECTION_CONTRACTOR

MAINTENANCE_CONTRACTOR

GENERAL

------------------------------------------------------------------------

Relationships

Organization

→ Branches

→ Teams

→ Users

→ Projects

------------------------------------------------------------------------

# 5. Branch

Represents company branch.

------------------------------------------------------------------------

Fields

id

organizationId

name

code

status

------------------------------------------------------------------------

Relationships

Branch

→ Teams

→ Users

→ MAINHEADs (legacy fallback)

------------------------------------------------------------------------

# 6. Operational Region

Governance G1.

Represents TNB region.

------------------------------------------------------------------------

Fields

id

name

code

status

createdAt

updatedAt

------------------------------------------------------------------------

Examples

Klang Valley

Johor

Pahang

Perak

------------------------------------------------------------------------

Relationships

OperationalRegion

→ MAINHEADs

------------------------------------------------------------------------

# 7. MAINHEAD

Represents operational area.

------------------------------------------------------------------------

Fields

id

operationalRegionId

name

code

status

createdAt

updatedAt

------------------------------------------------------------------------

Examples

KL Timur

KL Barat

Langat

Subang

Klang

------------------------------------------------------------------------

Relationships

MAINHEAD

→ Projects

→ Site Visits

→ Templates

------------------------------------------------------------------------

# 8. User

Represents authenticated person.

------------------------------------------------------------------------

Fields

id

email

passwordHash

name

phone

role

organizationId

branchId

status

lastLogin

createdAt

updatedAt

------------------------------------------------------------------------

Relationships

User

→ TeamMembership

→ UserMainheadAccess

→ UserOperationalRegionAccess

→ Inspections

→ Defects

→ Audit Logs

------------------------------------------------------------------------

# 9. Global Roles

ADMIN

VIEWER

CLIENT

------------------------------------------------------------------------

Operational roles handled through membership and workflow permissions.

------------------------------------------------------------------------

# 10. Team

Operational execution unit.

------------------------------------------------------------------------

Fields

id

organizationId

name

description

status

------------------------------------------------------------------------

Relationships

Team

→ Users

→ Site Visits

→ Defects

------------------------------------------------------------------------

# 11. Team Membership

Many-to-many.

------------------------------------------------------------------------

Fields

id

teamId

userId

role

createdAt

------------------------------------------------------------------------

Roles

LEADER

MEMBER

------------------------------------------------------------------------

# 12. UserMainheadAccess

Governance G1.

Supports multi-MAINHEAD visibility.

------------------------------------------------------------------------

Fields

id

userId

mainheadId

accessRole

------------------------------------------------------------------------

Access Roles

VIEW

OPERATE

MANAGE

------------------------------------------------------------------------

# 13. UserOperationalRegionAccess

Governance G1.

------------------------------------------------------------------------

Fields

id

userId

operationalRegionId

accessRole

------------------------------------------------------------------------

Purpose

Allows visibility inheritance across all MAINHEADs in region.

------------------------------------------------------------------------

# 14. Project

Contractual container.

------------------------------------------------------------------------

Fields

id

organizationId

mainheadId

name

code

description

status

------------------------------------------------------------------------

Relationships

Project

→ Work Packages

→ Site Visits

------------------------------------------------------------------------

# 15. Work Package

Operational subdivision.

------------------------------------------------------------------------

Fields

id

projectId

name

code

status

------------------------------------------------------------------------

Relationships

WorkPackage

→ Site Visits

------------------------------------------------------------------------

# 16. Site Visit

Operational session.

------------------------------------------------------------------------

Fields

id

visitNumber

projectId

workPackageId

mainheadId

status

startTime

endTime

createdBy

------------------------------------------------------------------------

Statuses

OPEN

IN_PROGRESS

COMPLETED

CANCELLED

ACTIVE (legacy)

------------------------------------------------------------------------

Relationships

SiteVisit

→ Assets

→ Participants

→ Inspections

------------------------------------------------------------------------

# 17. Site Visit Participant

Tracks assigned personnel.

------------------------------------------------------------------------

Fields

id

siteVisitId

userId

role

------------------------------------------------------------------------

Roles

LEADER

MEMBER

OBSERVER

------------------------------------------------------------------------

# 18. Asset

Physical utility asset.

------------------------------------------------------------------------

Fields

id

siteVisitId

assetType

assetCode

assetName

latitude

longitude

operationalStatus

remarks

createdAt

------------------------------------------------------------------------

Operational Status

EXISTING

NEW

NOT_FOUND

DEMOLISHED

------------------------------------------------------------------------

Uniqueness

tenantId

substationId

assetCode

------------------------------------------------------------------------

# 19. Asset Types

SAVR

SAVT

PENCAWANG

FEEDER_PILLAR

LINK_BOX

CABLE_BRIDGE

UNDERGROUND_CABLE

THERMAL_INSPECTION

------------------------------------------------------------------------

# 20. Inspection Template

Logical template.

------------------------------------------------------------------------

Fields

id

name

assetType

scopeLevel

scopeId

status

activeVersionId

------------------------------------------------------------------------

Statuses

DRAFT

ACTIVE

ARCHIVED

------------------------------------------------------------------------

# 21. Scope Levels

GLOBAL

ORGANIZATION

BRANCH

OPERATIONAL_REGION

MAINHEAD

------------------------------------------------------------------------

# 22. Template Resolution Order

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

# 23. Template Version

Versioned inspection definition.

------------------------------------------------------------------------

Fields

id

templateId

versionNumber

status

createdBy

publishedAt

------------------------------------------------------------------------

Relationships

TemplateVersion

→ ChecklistItems

------------------------------------------------------------------------

# 24. Checklist Item

Dynamic field.

------------------------------------------------------------------------

Fields

id

templateVersionId

label

fieldType

required

displayOrder

showIfRule

configuration

------------------------------------------------------------------------

Field Types

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

# 25. Inspection

Completed inspection record.

------------------------------------------------------------------------

Fields

id

assetId

templateVersionId

status

submittedBy

submittedAt

remarks

------------------------------------------------------------------------

Statuses

DRAFT

SUBMITTED

APPROVED

REJECTED

------------------------------------------------------------------------

# 26. Inspection Response

Stores checklist answers.

------------------------------------------------------------------------

Fields

id

inspectionId

checklistItemId

value

capturedAt

------------------------------------------------------------------------

Supports all dynamic field types.

------------------------------------------------------------------------

# 27. Defect

Generated operational defect.

------------------------------------------------------------------------

Fields

id

assetId

inspectionId

severity

description

status

resolutionOutcome

assignedTeamId

verifiedBy

closedBy

------------------------------------------------------------------------

# 28. Defect Lifecycle

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

# 29. Resolution Outcomes

RESOLVED

TEMPORARY_FIX

MONITORING_REQUIRED

EXTERNAL_CONSTRAINT

DEFERRED

------------------------------------------------------------------------

# 30. Defect Evidence Image

Maintenance proof.

------------------------------------------------------------------------

Fields

id

defectId

filePath

uploadedBy

uploadedAt

latitude

longitude

timestamp

------------------------------------------------------------------------

Supports multiple images.

------------------------------------------------------------------------

# 31. Timeline Event

Operational history.

------------------------------------------------------------------------

Fields

id

entityType

entityId

eventType

performedBy

comment

createdAt

------------------------------------------------------------------------

# 32. Timeline Event Types

STATUS_CHANGED

DEFECT_VERIFIED

DEFECT_REJECTED

DEFECT_ASSIGNED

MAINTENANCE_STARTED

MAINTENANCE_COMPLETED

CLOSURE_VERIFIED

------------------------------------------------------------------------

# 33. Audit Log

Governance record.

------------------------------------------------------------------------

Fields

id

entityType

entityId

action

oldValue

newValue

performedBy

createdAt

------------------------------------------------------------------------

# 34. Capability System

Operational permissions.

------------------------------------------------------------------------

Capability Examples

SAVR

SAVT

PENCAWANG

FEEDER_PILLAR

LINK_BOX

CABLE_BRIDGE

UNDERGROUND_CABLE

THERMAL_INSPECTION

MAINTENANCE

------------------------------------------------------------------------

# 35. Capability Assignment

Can be assigned to:

Organization

Branch

MAINHEAD

Team

User

------------------------------------------------------------------------

Purpose

Controls operational visibility and assignment.

------------------------------------------------------------------------

# 36. Offline Queue (Logical)

Mobile queue storage.

------------------------------------------------------------------------

Queue Types

Inspection Queue

Photo Queue

Visit Completion Queue

Maintenance Queue

------------------------------------------------------------------------

Stored Locally

AsyncStorage

------------------------------------------------------------------------

# 37. GPS Evidence

Captured for:

Check-In

Assets

Inspections

Maintenance Evidence

------------------------------------------------------------------------

Stored

Latitude

Longitude

Accuracy

Timestamp

------------------------------------------------------------------------

# 38. Image Evidence

Captured for:

Inspection

Defect

Maintenance

------------------------------------------------------------------------

Requirements

Timestamp Overlay

GPS Overlay

Offline Safe

------------------------------------------------------------------------

# 39. Future Entities

Notification

Push Token

Report Job

AI Validation

Object Storage Metadata

Analytics Snapshot

------------------------------------------------------------------------

# 40. Reconstruction Priority

Critical Tables

User

Organization

MAINHEAD

OperationalRegion

Asset

Inspection

Defect

Template

TemplateVersion

ChecklistItem

------------------------------------------------------------------------

Secondary Tables

AuditLog

TimelineEvent

Capabilities

Notifications

Analytics

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V4
