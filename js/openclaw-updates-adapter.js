(function initOpenClawUpdatesAdapter(global) {
    const MOCK_STORAGE_KEY = 'openclaw_updates_mock_v1';

    /**
     * @typedef {'all_active'|'selected'} UpdateScope
     * @typedef {'rollout'|'rollback'} UpdateOperation
     * @typedef {'queued'|'running'|'completed'|'completed_with_errors'|'failed'} UpdateRunStatus
     * @typedef {'pending'|'success'|'failed'} TenantRunStatus
     *
     * @typedef {Object} StartRolloutPayload
     * @property {string=} targetVersion
     * @property {string=} imageUri
     * @property {UpdateScope=} scope
     * @property {string[]=} tenantIds
     * @property {boolean=} includePaused
     * @property {boolean=} dryRun
     * @property {boolean=} skipBackup
     *
     * @typedef {Object} StartRollbackPayload
     * @property {string} runId
     * @property {string[]=} tenantIds
     * @property {boolean=} restoreBackup
     * @property {boolean=} dryRun
     *
     * @typedef {Object} TenantVersionRecord
     * @property {string} tenantId
     * @property {string=} email
     * @property {string=} name
     * @property {string=} status
     * @property {string=} openClawVersion
     * @property {string=} lastUpdateStatus
     * @property {string=} lastUpdateTime
     *
     * @typedef {Object} TenantRunRecord
     * @property {string} tenantId
     * @property {TenantRunStatus} status
     * @property {string} previousVersion
     * @property {string} newVersion
     * @property {string=} message
     * @property {string=} error
     *
     * @typedef {Object} UpdateRun
     * @property {string} runId
     * @property {UpdateOperation} operation
     * @property {UpdateRunStatus} status
     * @property {string} startedAt
     * @property {string=} finishedAt
     * @property {number} successCount
     * @property {number} failedCount
     * @property {number} tenantCount
     * @property {boolean} dryRun
     * @property {string=} targetVersion
     * @property {string=} imageUri
     * @property {boolean=} includePaused
     * @property {boolean=} skipBackup
     * @property {boolean=} restoreBackup
     * @property {TenantRunRecord[]=} tenants
     */

    class AdapterError extends Error {
        constructor(message, code) {
            super(message);
            this.name = 'AdapterError';
            this.code = code;
        }
    }

    function authHeaders(extra) {
        const token = global.localStorage?.getItem('clawops_session_token');
        if (!token) return { ...(extra || {}) };
        return { Authorization: `Bearer ${token}`, ...(extra || {}) };
    }

    async function requestJson(url, options) {
        let response;
        try {
            response = await fetch(url, {
                ...(options || {}),
                headers: authHeaders(options?.headers),
            });
        } catch (err) {
            throw new AdapterError(err?.message || 'Network request failed', 'NETWORK');
        }

        const body = await response.json().catch(() => ({}));
        if (response.ok && body?.ok !== false) return body;

        const message = body?.error || body?.message || `Request failed (${response.status})`;
        if ([404, 405, 501].includes(response.status)) throw new AdapterError(message, 'MISSING_ENDPOINT');
        if (response.status === 401) throw new AdapterError(message, 'UNAUTHORIZED');
        if (response.status === 403) throw new AdapterError(message, 'FORBIDDEN');
        throw new AdapterError(message, 'REQUEST_FAILED');
    }

    function shouldFallbackToMock(err) {
        return Boolean(err && ['MISSING_ENDPOINT', 'NETWORK'].includes(err.code));
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function generateRunId(prefix) {
        const seed = Math.random().toString(36).slice(2, 8);
        return `${prefix || 'run'}_${Date.now().toString(36)}_${seed}`;
    }

    function hashToUnit(input) {
        const value = String(input || '');
        let hash = 2166136261;
        for (let i = 0; i < value.length; i += 1) {
            hash ^= value.charCodeAt(i);
            hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
        }
        return Math.abs(hash % 1000) / 1000;
    }

    function readMockState() {
        const raw = global.localStorage?.getItem(MOCK_STORAGE_KEY);
        if (!raw) return { version: 1, tenants: [], runs: [] };
        try {
            const parsed = JSON.parse(raw);
            return {
                version: 1,
                tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
                runs: Array.isArray(parsed.runs) ? parsed.runs : [],
            };
        } catch {
            return { version: 1, tenants: [], runs: [] };
        }
    }

    function writeMockState(state) {
        global.localStorage?.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    }

    function normalizeVersion(value) {
        const cleaned = String(value || '').trim();
        return cleaned || 'unknown';
    }

    function normalizeTenantRecord(input) {
        return {
            tenantId: String(input?.tenantId || input?.id || ''),
            email: input?.email || null,
            name: input?.name || null,
            status: input?.status || 'active',
            openClawVersion: normalizeVersion(
                input?.openClawVersion || input?.openclawVersion || input?.version || input?.imageTag
            ),
            lastUpdateStatus: input?.lastUpdateStatus || input?.updateStatus || null,
            lastUpdateTime: input?.lastUpdateTime || input?.lastUpdateAt || null,
        };
    }

    function normalizeRunSummary(run) {
        return {
            runId: run.runId,
            operation: run.operation,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt || null,
            successCount: Number(run.successCount || 0),
            failedCount: Number(run.failedCount || 0),
            tenantCount: Number(run.tenantCount || (run.tenants || []).length || 0),
            dryRun: Boolean(run.dryRun),
            targetVersion: run.targetVersion || null,
            imageUri: run.imageUri || null,
            includePaused: Boolean(run.includePaused),
            skipBackup: Boolean(run.skipBackup),
            restoreBackup: Boolean(run.restoreBackup),
        };
    }

    function inferVersionFromImageUri(imageUri) {
        const text = String(imageUri || '').trim();
        if (!text) return null;
        const match = text.match(/:([A-Za-z0-9._-]+)$/);
        if (match?.[1]) return match[1];
        return text;
    }

    function pickScopedTenants(tenants, payload) {
        const includePaused = Boolean(payload.includePaused);
        const tenantIds = Array.isArray(payload.tenantIds)
            ? payload.tenantIds.map((id) => String(id).trim()).filter(Boolean)
            : [];

        if (payload.scope === 'selected') {
            const idSet = new Set(tenantIds);
            return tenants.filter((t) => idSet.has(t.tenantId));
        }

        return tenants.filter((t) => {
            if (t.status === 'terminated') return false;
            if (t.status === 'paused') return includePaused;
            return t.status === 'active' || !t.status;
        });
    }

    function mapFromAdminClientsPayload(payload) {
        const clients = Array.isArray(payload?.clients) ? payload.clients : [];
        const rows = [];
        for (const client of clients) {
            for (const bot of (client.bots || [])) {
                rows.push(normalizeTenantRecord({
                    tenantId: bot.tenantId,
                    email: client.email,
                    name: bot.name,
                    status: bot.status,
                    openClawVersion: bot.openClawVersion,
                    lastUpdateStatus: bot.lastUpdateStatus,
                    lastUpdateTime: bot.lastUpdateTime,
                }));
            }
        }
        return rows;
    }

    function mapFromDashboardBotsPayload(payload) {
        const bots = Array.isArray(payload?.bots) ? payload.bots : [];
        return bots.map((bot) => normalizeTenantRecord({
            tenantId: bot.id,
            name: bot.name,
            status: bot.status,
            openClawVersion: bot.openClawVersion,
            lastUpdateStatus: bot.lastUpdateStatus,
            lastUpdateTime: bot.lastUpdateTime,
        }));
    }

    function ensureUniqueTenants(rows) {
        const map = new Map();
        for (const row of rows || []) {
            if (!row?.tenantId) continue;
            map.set(row.tenantId, normalizeTenantRecord(row));
        }
        return Array.from(map.values());
    }

    function ensureRunProgress(state, runId) {
        const run = state.runs.find((item) => item.runId === runId);
        if (!run || run.status !== 'running') return run;

        let changed = false;
        let processed = 0;
        const now = nowIso();

        for (const tenantRun of run.tenants || []) {
            if (tenantRun.status !== 'pending') continue;
            const failureRateBase = run.operation === 'rollback' ? 0.14 : 0.18;
            const failureRate = run.dryRun ? failureRateBase * 0.75 : failureRateBase;
            const shouldFail = hashToUnit(`${run.runId}:${tenantRun.tenantId}:${processed}`) < failureRate;

            if (shouldFail) {
                tenantRun.status = 'failed';
                tenantRun.error = run.operation === 'rollback'
                    ? 'Backup restore verification failed.'
                    : 'Image pull or health check failed.';
                tenantRun.message = null;
                run.failedCount += 1;
            } else {
                tenantRun.status = 'success';
                tenantRun.error = null;
                tenantRun.message = run.operation === 'rollback'
                    ? `Rolled back to ${tenantRun.newVersion}`
                    : `Updated to ${tenantRun.newVersion}`;
                run.successCount += 1;
            }

            processed += 1;
            changed = true;
            if (processed >= 4) break;
        }

        const stillPending = (run.tenants || []).some((entry) => entry.status === 'pending');
        if (!stillPending) {
            run.status = run.failedCount > 0 ? 'completed_with_errors' : 'completed';
            run.finishedAt = now;
            changed = true;

            if (!run.dryRun) {
                const tenantMap = new Map((state.tenants || []).map((t) => [t.tenantId, t]));
                for (const entry of run.tenants || []) {
                    const tenant = tenantMap.get(entry.tenantId);
                    if (!tenant) continue;
                    tenant.lastUpdateTime = now;
                    if (entry.status === 'success') {
                        tenant.openClawVersion = normalizeVersion(entry.newVersion);
                        tenant.lastUpdateStatus = 'success';
                    } else if (entry.status === 'failed') {
                        tenant.lastUpdateStatus = 'failed';
                    }
                }
            }
        }

        if (changed) writeMockState(state);
        return run;
    }

    function sortRuns(runs) {
        return (runs || []).slice().sort((a, b) => {
            return String(b.startedAt || '').localeCompare(String(a.startedAt || ''));
        });
    }

    function parseComparableVersion(input) {
        const raw = String(input || '').trim();
        if (!raw) return null;
        const match = raw.match(/v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
        if (!match) return null;
        return {
            major: Number(match[1]),
            minor: Number(match[2]),
            patch: Number(match[3]),
        };
    }

    function sortVersionsDesc(values) {
        const cleaned = (values || []).map((v) => String(v || '').trim()).filter(Boolean);
        const unique = Array.from(new Set(cleaned));
        unique.sort((a, b) => {
            const va = parseComparableVersion(a);
            const vb = parseComparableVersion(b);
            if (va && vb) {
                if (va.major !== vb.major) return vb.major - va.major;
                if (va.minor !== vb.minor) return vb.minor - va.minor;
                if (va.patch !== vb.patch) return vb.patch - va.patch;
                return b.localeCompare(a);
            }
            if (va) return -1;
            if (vb) return 1;
            return b.localeCompare(a);
        });
        return unique;
    }

    class OpenClawUpdatesAdapter {
        constructor() {
            this.useMockMode = false;
        }

        async startRollout(payload) {
            const normalized = {
                targetVersion: String(payload?.targetVersion || '').trim() || undefined,
                imageUri: String(payload?.imageUri || '').trim() || undefined,
                scope: payload?.scope === 'selected' ? 'selected' : 'all_active',
                tenantIds: Array.isArray(payload?.tenantIds) ? payload.tenantIds.filter(Boolean) : [],
                includePaused: Boolean(payload?.includePaused),
                dryRun: payload?.dryRun !== false,
                skipBackup: Boolean(payload?.skipBackup),
            };

            if (this.useMockMode) return this.startRolloutMock(normalized);
            try {
                return await requestJson('/api/admin/updates/rollout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(normalized),
                });
            } catch (err) {
                if (!shouldFallbackToMock(err)) throw err;
                this.useMockMode = true;
                return this.startRolloutMock(normalized);
            }
        }

        async getUpdateRuns(filters) {
            const params = new URLSearchParams();
            if (filters?.failedOnly) params.set('failedOnly', '1');
            if (filters?.runId) params.set('runId', String(filters.runId).trim());

            if (this.useMockMode) return this.getUpdateRunsMock(filters);
            try {
                return await requestJson(`/api/admin/updates/runs?${params.toString()}`);
            } catch (err) {
                if (!shouldFallbackToMock(err)) throw err;
                this.useMockMode = true;
                return this.getUpdateRunsMock(filters);
            }
        }

        async getUpdateRun(runId, failedOnly) {
            const id = String(runId || '').trim();
            const params = failedOnly ? '?failedOnly=1' : '';

            if (this.useMockMode) return this.getUpdateRunMock(id, Boolean(failedOnly));
            try {
                return await requestJson(`/api/admin/updates/runs/${encodeURIComponent(id)}${params}`);
            } catch (err) {
                if (!shouldFallbackToMock(err)) throw err;
                this.useMockMode = true;
                return this.getUpdateRunMock(id, Boolean(failedOnly));
            }
        }

        async startRollback(payload) {
            const normalized = {
                runId: String(payload?.runId || '').trim(),
                tenantIds: Array.isArray(payload?.tenantIds) ? payload.tenantIds.filter(Boolean) : [],
                restoreBackup: Boolean(payload?.restoreBackup),
                dryRun: payload?.dryRun !== false,
            };

            if (this.useMockMode) return this.startRollbackMock(normalized);
            try {
                return await requestJson('/api/admin/updates/rollback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(normalized),
                });
            } catch (err) {
                if (!shouldFallbackToMock(err)) throw err;
                this.useMockMode = true;
                return this.startRollbackMock(normalized);
            }
        }

        async getTenantVersions() {
            if (this.useMockMode) return this.getTenantVersionsMock();
            try {
                const payload = await requestJson('/api/admin/updates/tenant-versions');
                const tenants = ensureUniqueTenants(payload?.tenants || payload?.items || []);
                return { ok: true, source: 'api', tenants };
            } catch (err) {
                if (!shouldFallbackToMock(err) && !['FORBIDDEN', 'UNAUTHORIZED'].includes(err.code)) {
                    throw err;
                }
                this.useMockMode = true;
                return this.getTenantVersionsMock();
            }
        }

        async getVersionCatalog() {
            if (this.useMockMode) return this.getVersionCatalogMock();
            try {
                return await requestJson('/api/admin/updates/version-catalog');
            } catch (err) {
                if (!shouldFallbackToMock(err) && !['FORBIDDEN', 'UNAUTHORIZED', 'REQUEST_FAILED'].includes(err.code)) {
                    throw err;
                }
                return this.getVersionCatalogMock();
            }
        }

        async seedMockTenants(state) {
            if ((state.tenants || []).length > 0) return state;

            const collected = [];
            try {
                const adminClients = await requestJson('/api/admin/clients');
                collected.push(...mapFromAdminClientsPayload(adminClients));
            } catch {
                // ignore
            }

            try {
                const botsPayload = await requestJson('/api/dashboard/bots');
                collected.push(...mapFromDashboardBotsPayload(botsPayload));
            } catch {
                // ignore
            }

            state.tenants = ensureUniqueTenants(collected).map((tenant) => ({
                ...tenant,
                openClawVersion: normalizeVersion(tenant.openClawVersion),
                lastUpdateStatus: tenant.lastUpdateStatus || null,
                lastUpdateTime: tenant.lastUpdateTime || null,
            }));

            writeMockState(state);
            return state;
        }

        async getTenantVersionsMock() {
            const state = await this.seedMockTenants(readMockState());
            return {
                ok: true,
                source: 'mock',
                tenants: clone(state.tenants || []),
            };
        }

        async getVersionCatalogMock() {
            const state = await this.seedMockTenants(readMockState());
            const observed = sortVersionsDesc(
                (state.tenants || [])
                    .map((tenant) => normalizeVersion(tenant.openClawVersion))
                    .filter((v) => v && v !== 'unknown')
            );
            const recentVersions = observed.slice(0, 5);
            return {
                ok: true,
                source: 'mock',
                recommendedVersion: recentVersions[0] || null,
                recentVersions,
                sources: {
                    github: {
                        configured: false,
                        latest: null,
                        recentVersions: [],
                        note: 'GitHub source unavailable in mock mode.',
                    },
                    tenants: {
                        latest: recentVersions[0] || null,
                        recentVersions,
                        observedCount: observed.length,
                    },
                },
            };
        }

        async startRolloutMock(payload) {
            const state = await this.seedMockTenants(readMockState());
            const tenants = pickScopedTenants(state.tenants || [], payload);
            if (tenants.length === 0) {
                throw new AdapterError('No tenants matched the selected rollout scope.', 'REQUEST_FAILED');
            }

            const targetVersion = payload.targetVersion || inferVersionFromImageUri(payload.imageUri) || 'latest';
            const run = {
                runId: generateRunId('rollout'),
                operation: 'rollout',
                status: 'running',
                startedAt: nowIso(),
                finishedAt: null,
                successCount: 0,
                failedCount: 0,
                tenantCount: tenants.length,
                dryRun: Boolean(payload.dryRun),
                targetVersion,
                imageUri: payload.imageUri || null,
                includePaused: Boolean(payload.includePaused),
                skipBackup: Boolean(payload.skipBackup),
                restoreBackup: false,
                tenants: tenants.map((tenant) => ({
                    tenantId: tenant.tenantId,
                    status: 'pending',
                    previousVersion: normalizeVersion(tenant.openClawVersion),
                    newVersion: normalizeVersion(targetVersion),
                    message: 'Queued for rollout.',
                    error: null,
                })),
            };

            state.runs.unshift(run);
            writeMockState(state);
            return { ok: true, source: 'mock', run: clone(normalizeRunSummary(run)), runId: run.runId };
        }

        async getUpdateRunsMock(filters) {
            const state = await this.seedMockTenants(readMockState());
            for (const run of state.runs || []) ensureRunProgress(state, run.runId);

            let runs = sortRuns(state.runs || []).map((run) => normalizeRunSummary(run));
            const query = String(filters?.runId || '').trim().toLowerCase();
            if (filters?.failedOnly) runs = runs.filter((run) => run.failedCount > 0);
            if (query) runs = runs.filter((run) => run.runId.toLowerCase().includes(query));

            return { ok: true, source: 'mock', runs };
        }

        async getUpdateRunMock(runId, failedOnly) {
            const state = await this.seedMockTenants(readMockState());
            const run = ensureRunProgress(state, runId);
            if (!run) throw new AdapterError('Run not found', 'REQUEST_FAILED');

            const orderedTenants = (run.tenants || []).slice().sort((a, b) => {
                const priority = { failed: 0, pending: 1, success: 2 };
                const delta = (priority[a.status] ?? 99) - (priority[b.status] ?? 99);
                if (delta !== 0) return delta;
                return a.tenantId.localeCompare(b.tenantId);
            });

            const tenantRows = failedOnly
                ? orderedTenants.filter((row) => row.status === 'failed')
                : orderedTenants;

            return {
                ok: true,
                source: 'mock',
                run: {
                    ...normalizeRunSummary(run),
                    tenants: clone(tenantRows),
                },
            };
        }

        async startRollbackMock(payload) {
            if (!payload.runId) {
                throw new AdapterError('runId is required for rollback.', 'REQUEST_FAILED');
            }

            const state = await this.seedMockTenants(readMockState());
            const sourceRun = state.runs.find((run) => run.runId === payload.runId);
            if (!sourceRun) {
                throw new AdapterError(`Run ${payload.runId} was not found.`, 'REQUEST_FAILED');
            }

            const allEntries = Array.isArray(sourceRun.tenants) ? sourceRun.tenants : [];
            const requestedIds = new Set((payload.tenantIds || []).map((id) => String(id).trim()).filter(Boolean));
            const selected = requestedIds.size
                ? allEntries.filter((entry) => requestedIds.has(entry.tenantId))
                : allEntries;

            if (selected.length === 0) {
                throw new AdapterError('No tenants matched the rollback filter.', 'REQUEST_FAILED');
            }

            const tenantMap = new Map((state.tenants || []).map((t) => [t.tenantId, t]));
            const rollbackRun = {
                runId: generateRunId('rollback'),
                operation: 'rollback',
                status: 'running',
                startedAt: nowIso(),
                finishedAt: null,
                successCount: 0,
                failedCount: 0,
                tenantCount: selected.length,
                dryRun: Boolean(payload.dryRun),
                targetVersion: null,
                imageUri: null,
                includePaused: false,
                skipBackup: false,
                restoreBackup: Boolean(payload.restoreBackup),
                sourceRunId: payload.runId,
                tenants: selected.map((entry) => {
                    const tenant = tenantMap.get(entry.tenantId);
                    const currentVersion = normalizeVersion(tenant?.openClawVersion);
                    const rollbackVersion = normalizeVersion(entry.previousVersion);
                    return {
                        tenantId: entry.tenantId,
                        status: 'pending',
                        previousVersion: currentVersion,
                        newVersion: rollbackVersion,
                        message: 'Queued for rollback.',
                        error: null,
                    };
                }),
            };

            state.runs.unshift(rollbackRun);
            writeMockState(state);
            return { ok: true, source: 'mock', run: clone(normalizeRunSummary(rollbackRun)), runId: rollbackRun.runId };
        }
    }

    global.OpenClawUpdatesAdapter = new OpenClawUpdatesAdapter();
})(window);
