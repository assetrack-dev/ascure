# ASCURE BLUEPRINT V8

# Permission Matrix & Access Control Specification

Version: 1.0

Purpose:

Define all access control behavior within ASCURE.

This document governs:

- Visibility
- Create permissions
- Update permissions
- Approval permissions
- Assignment permissions
- Verification permissions
- Closure permissions

This document overrides implementation assumptions.

If code behavior differs from this document, this document represents
intended governance.

------------------------------------------------------------------------

# 1. Access Control Philosophy

ASCURE uses layered access control.

Access is determined by:

Role

Organization

Branch

Team

MAINHEAD Access

Operational Region Access

------------------------------------------------------------------------

# 2. Global Roles

ADMIN

VIEWER

CLIENT

------------------------------------------------------------------------

These are platform-level roles.

Operational permissions are additionally governed by workflow rules.

------------------------------------------------------------------------

# 3. Operational Personas

Administrator

QA Supervisor

QA Inspector

Manager

Team Leader

Technician

Maintenance Technician

Viewer

------------------------------------------------------------------------

# 4. Administrator

Purpose:

Platform administration.

------------------------------------------------------------------------

Visibility

All Organizations

All Regions

All MAINHEADs

All Projects

All Assets

All Inspections

All Defects

------------------------------------------------------------------------

Actions

Create Users

Edit Users

Deactivate Users

Create Organizations

Create Teams

Manage Templates

Manage Governance

Manage Configuration

------------------------------------------------------------------------

Restrictions

None.

------------------------------------------------------------------------

# 5. QA Supervisor

Purpose:

Governance authority.

------------------------------------------------------------------------

Visibility

All Regions

All MAINHEADs

All Contractors

All Projects

All Defects

All Inspections

------------------------------------------------------------------------

Actions

Approve Inspection

Reject Inspection

Verify Defect

Reject Defect

Approve Closure

Reject Closure

Review Evidence

Audit Records

------------------------------------------------------------------------

Restrictions

Cannot modify submitted inspection data.

------------------------------------------------------------------------

# 6. QA Inspector

Purpose:

Operational verification.

------------------------------------------------------------------------

Visibility

All Regions

All MAINHEADs

All Contractor Data

------------------------------------------------------------------------

Actions

Approve Inspection

Reject Inspection

Verify Defect

Review Evidence

Approve Closure

Reject Closure

------------------------------------------------------------------------

Restrictions

Cannot modify inspection content.

------------------------------------------------------------------------

# 7. Manager

Purpose:

Operational management.

------------------------------------------------------------------------

Visibility

Own Organization

Assigned MAINHEADs

Assigned Projects

Assigned Site Visits

Assigned Teams

------------------------------------------------------------------------

Actions

Create Site Visits

Assign Teams

Monitor Progress

Assign Defects

View Reports

Manage Operational Users

------------------------------------------------------------------------

Restrictions

Cannot verify defects.

Cannot close defects.

Cannot override QA decisions.

------------------------------------------------------------------------

# 8. Team Leader

Purpose:

Field coordination.

------------------------------------------------------------------------

Visibility

Assigned Teams

Assigned Site Visits

Assigned Assets

Assigned Defects

------------------------------------------------------------------------

Actions

Create Site Visits

Check-In

Create Assets

Perform Inspections

Manage Team Work

Upload Evidence

Mark Completed

------------------------------------------------------------------------

Restrictions

Cannot verify defects.

Cannot approve inspections.

Cannot close defects.

------------------------------------------------------------------------

# 9. Technician

Purpose:

Operational execution.

------------------------------------------------------------------------

Visibility

Assigned Work Only

Assigned Visits

Assigned Assets

Assigned Defects

------------------------------------------------------------------------

Actions

Check-In

Create Assets

Perform Inspections

Upload Evidence

Submit Work

------------------------------------------------------------------------

Restrictions

Cannot:

Approve

Verify

Assign

Close

Manage Users

Manage Templates

------------------------------------------------------------------------

# 10. Maintenance Technician

Purpose:

Repair execution.

------------------------------------------------------------------------

Visibility

Assigned Defects

Assigned Assets

Assigned Maintenance Work

------------------------------------------------------------------------

Actions

Start Work

Upload Evidence

Add Notes

Mark Completed

------------------------------------------------------------------------

Restrictions

Cannot verify defects.

Cannot approve closure.

Cannot edit inspections.

------------------------------------------------------------------------

# 11. Viewer

Purpose:

Read-only access.

------------------------------------------------------------------------

Visibility

Configured Scope Only

------------------------------------------------------------------------

Actions

View

Search

Filter

Export

------------------------------------------------------------------------

Restrictions

No modifications.

------------------------------------------------------------------------

# 12. MAINHEAD Access Roles

Governance G1.

------------------------------------------------------------------------

VIEW

Can view records.

------------------------------------------------------------------------

OPERATE

Can perform operational actions.

------------------------------------------------------------------------

MANAGE

Can manage operational configuration.

------------------------------------------------------------------------

# 13. Operational Region Access

Region access grants inherited visibility.

------------------------------------------------------------------------

Example

Region:

Klang Valley

------------------------------------------------------------------------

Visible MAINHEADs:

KL Timur

KL Barat

Subang

Langat

Klang

------------------------------------------------------------------------

# 14. Organization Visibility

Default Rule

Users see records belonging to:

Their organization.

------------------------------------------------------------------------

Exceptions

ADMIN

QA

------------------------------------------------------------------------

# 15. QA Visibility Override

QA users may access:

All organizations

All regions

All MAINHEADs

------------------------------------------------------------------------

Reason

Governance independence.

------------------------------------------------------------------------

# 16. Site Visit Permissions

Create Site Visit

ADMIN

Manager

Team Leader

------------------------------------------------------------------------

Edit Site Visit

ADMIN

Manager

Creator

------------------------------------------------------------------------

Complete Site Visit

ADMIN

Manager

Team Leader

------------------------------------------------------------------------

Cancel Site Visit

ADMIN

Manager

------------------------------------------------------------------------

# 17. Asset Permissions

Create Asset

ADMIN

Manager

Team Leader

Technician

------------------------------------------------------------------------

Edit Asset

ADMIN

Manager

Creator

------------------------------------------------------------------------

Delete Asset

ADMIN only

------------------------------------------------------------------------

Soft delete preferred.

------------------------------------------------------------------------

# 18. Inspection Permissions

Create Inspection

Technician

Team Leader

Manager

------------------------------------------------------------------------

Save Draft

Creator

------------------------------------------------------------------------

Submit

Creator

------------------------------------------------------------------------

Approve

QA

ADMIN

------------------------------------------------------------------------

Reject

QA

ADMIN

------------------------------------------------------------------------

# 19. Defect Permissions

Create

System Generated

or QA

------------------------------------------------------------------------

Verify

QA

ADMIN

------------------------------------------------------------------------

Reject

QA

ADMIN

------------------------------------------------------------------------

Assign

Manager

ADMIN

------------------------------------------------------------------------

Start Work

Assigned Maintenance Team

------------------------------------------------------------------------

Complete Work

Assigned Maintenance Team

------------------------------------------------------------------------

Close

QA

ADMIN

------------------------------------------------------------------------

# 20. Closure Authority

Only:

QA

ADMIN

may close defects.

------------------------------------------------------------------------

Non-negotiable rule.

------------------------------------------------------------------------

# 21. Template Permissions

Create Template

ADMIN

------------------------------------------------------------------------

Edit Draft

ADMIN

------------------------------------------------------------------------

Activate

ADMIN

------------------------------------------------------------------------

Archive

ADMIN

------------------------------------------------------------------------

Technicians never modify templates.

------------------------------------------------------------------------

# 22. User Management Permissions

Create User

ADMIN

------------------------------------------------------------------------

Edit User

ADMIN

------------------------------------------------------------------------

Deactivate User

ADMIN

------------------------------------------------------------------------

Reset Password

ADMIN

------------------------------------------------------------------------

# 23. Organization Permissions

Create Organization

ADMIN

------------------------------------------------------------------------

Edit Organization

ADMIN

------------------------------------------------------------------------

Deactivate Organization

ADMIN

------------------------------------------------------------------------

# 24. Operational Region Permissions

Create Region

ADMIN

------------------------------------------------------------------------

Edit Region

ADMIN

------------------------------------------------------------------------

Deactivate Region

ADMIN

------------------------------------------------------------------------

# 25. MAINHEAD Permissions

Create MAINHEAD

ADMIN

------------------------------------------------------------------------

Edit MAINHEAD

ADMIN

------------------------------------------------------------------------

Deactivate MAINHEAD

ADMIN

------------------------------------------------------------------------

# 26. Project Permissions

Create Project

ADMIN

Manager

------------------------------------------------------------------------

Edit Project

ADMIN

Manager

------------------------------------------------------------------------

Archive Project

ADMIN

------------------------------------------------------------------------

# 27. Work Package Permissions

Create

ADMIN

Manager

------------------------------------------------------------------------

Edit

ADMIN

Manager

------------------------------------------------------------------------

Archive

ADMIN

------------------------------------------------------------------------

# 28. Team Permissions

Create Team

ADMIN

Manager

------------------------------------------------------------------------

Assign Users

ADMIN

Manager

------------------------------------------------------------------------

Remove Users

ADMIN

Manager

------------------------------------------------------------------------

# 29. Evidence Permissions

Upload Inspection Evidence

Inspection User

------------------------------------------------------------------------

Upload Maintenance Evidence

Assigned Maintenance User

------------------------------------------------------------------------

Delete Evidence

ADMIN only

------------------------------------------------------------------------

Historical evidence should never be removed unless legally required.

------------------------------------------------------------------------

# 30. Audit Log Permissions

View Audit Logs

ADMIN

QA Supervisor

------------------------------------------------------------------------

Edit Audit Logs

Never.

------------------------------------------------------------------------

Delete Audit Logs

Never.

------------------------------------------------------------------------

# 31. Operations Board Permissions

View

ADMIN

QA

Manager

------------------------------------------------------------------------

Technicians do not require Operations Board access.

------------------------------------------------------------------------

# 32. Reporting Permissions

View Reports

ADMIN

QA

Manager

Viewer

------------------------------------------------------------------------

Export Reports

ADMIN

QA

Manager

------------------------------------------------------------------------

# 33. Mobile Workspace Permissions

Inspection Workspace

Technician

Team Leader

Manager

------------------------------------------------------------------------

Maintenance Workspace

Maintenance Users

Manager

------------------------------------------------------------------------

QA users normally operate through Admin Web.

------------------------------------------------------------------------

# 34. Offline Queue Permissions

View Queue

Owner

Manager

ADMIN

------------------------------------------------------------------------

Retry Sync

Owner

ADMIN

------------------------------------------------------------------------

# 35. Future Permissions

Notification Management

SLA Management

Contractor Scoring

AI Validation Review

Regional Performance Review

------------------------------------------------------------------------

# 36. Permission Principles

Least privilege.

------------------------------------------------------------------------

Operational users see only what they need.

------------------------------------------------------------------------

Governance users see what they must verify.

------------------------------------------------------------------------

Administration remains centralized.

------------------------------------------------------------------------

# 37. Non-Negotiable Access Rules

QA may view all MAINHEADs.

QA may verify defects.

QA may close defects.

Technicians cannot close defects.

Maintenance cannot verify defects.

Managers cannot override QA.

Audit logs immutable.

Template history immutable.

------------------------------------------------------------------------

END OF ASCURE BLUEPRINT V8
