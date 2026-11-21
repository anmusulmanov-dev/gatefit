-- Hand-written: the new members.archive permission joins the standard owner and manager
-- roles of every existing organization (packages/shared/src/permissions.ts). New
-- organizations get it when their roles are created.
INSERT INTO role_permissions (organization_id, role_id, permission, created_at)
SELECT r.organization_id, r.id, 'members.archive', now()
FROM roles r
WHERE r.is_system AND r.name IN ('owner', 'manager') AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;
