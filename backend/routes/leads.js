const router = require('express').Router();
const https = require('https');
const { authenticate } = require('../middleware/auth');
const db = require('../models/database');

// In-memory cache
const _cache = {};
function cacheGet(key) {
  const e = _cache[key];
  return (e && e.expires > Date.now()) ? e.value : null;
}
function cacheSet(key, value, ttlMs) {
  _cache[key] = { value, expires: Date.now() + ttlMs };
}
function httpsRequest(options, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(bodyObj);
    const opts = { ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(bodyStr) } };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buffer: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

router.post('/', authenticate, async (req, res) => {
  const HS_KEY = process.env.HUBSPOT_TOKEN || process.env.HS_TOKEN || process.env.HUBSPOT_API_KEY;

  const { action, payload } = req.body;
  if (!action || !payload) return res.status(400).json({ error: 'action oder payload fehlt' });

  // ── ANALYZE ──
  if (action === 'analyze') {
    const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
    if (!CLAUDE_KEY) return res.status(500).json({ error: 'CLAUDE_API_KEY nicht konfiguriert – bitte in Railway setzen' });
    let { imageBase64, imageMime } = payload;
    if (!imageBase64) return res.status(400).json({ error: 'imageBase64 fehlt' });

    try {
      const result = await httpsRequest({
        hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' }
      }, {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMime || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'Das ist ein Screenshot von Instagram eines Gastronomie-Unternehmens.\n\nAntworte NUR mit diesem JSON, ohne Erklärung, ohne Markdown:\n{"name": "Unternehmensname", "instagram": "username_ohne_at", "website": "https://..."}\n\nRegeln:\n- \'name\': Der angezeigte Profilname, NICHT die Domain, NICHT der Username. Falls unbekannt: "UNBEKANNT"\n- \'instagram\': Der @-Username ohne @ (z.B. "hanedan.koeln").\n- \'website\': Nur direkte Unternehmenswebsite. NICHT instagram.com, linktr.ee, lieferando.de oder andere Drittanbieter. Sonst null.' }
          ]
        }]
      });

      if (result.status !== 200) return res.status(500).json({ error: 'Claude Fehler: ' + JSON.stringify(result.body) });
      const raw = (result.body.content?.[0]?.text || '').trim().replace(/^```json\s*/,'').replace(/```$/,'').trim();
      let name = 'UNBEKANNT', website = null, instagram = null;
      try {
        const p = JSON.parse(raw);
        name = p.name || 'UNBEKANNT';
        website = p.website || null;
        instagram = p.instagram || null;
      } catch { name = raw; }
      return res.json({ name, website, instagram });
    } catch (e) {
      return res.status(500).json({ error: 'Claude Fehler: ' + e.message });
    }
  }

  // ── SEARCH ──
  if (action === 'search') {
    if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert' });
    const { query, website, instagram } = payload;

    const WEBSITE_BLACKLIST = ['apetitomenu', 'linktr.ee', 'linktree', 'rausgegangen', 'lieferando', 'speisekarte', 'tripadvisor', 'google', 'yelp', 'thefork', 'opentable'];
    const cleanWebsite = website && !WEBSITE_BLACKLIST.some(b => website.includes(b)) ? website : null;
    const coreKeyword = instagram
      ? instagram.replace(/\.(de|com|nl|eu|net|org|cafe|bar|restaurant|koeln|berlin|hamburg|muenchen|frankfurt)$/i, '').replace(/[._-]/g, ' ').trim().split(' ')[0]
      : query.replace(/\.(de|com|nl|eu|net|org)$/i, '').trim();

    try {
      const searches = [];
      const hsHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HS_KEY };
      const props = ['name', 'website', 'domain', 'city', 'hubspot_owner_id', 'hs_object_id', 'description'];

      if (instagram) searches.push(httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/search', method: 'POST', headers: hsHeaders },
        { filterGroups: [{ filters: [{ propertyName: 'description', operator: 'CONTAINS_TOKEN', value: instagram }] }], properties: props, limit: 5 }));

      searches.push(httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/search', method: 'POST', headers: hsHeaders },
        { filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: query }] }], properties: props, limit: 8 }));

      if (coreKeyword && coreKeyword !== query && coreKeyword.length >= 4) searches.push(httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/search', method: 'POST', headers: hsHeaders },
        { filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: coreKeyword }] }], properties: props, limit: 8 }));

      if (cleanWebsite) {
        const domain = cleanWebsite.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
        searches.push(httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/search', method: 'POST', headers: hsHeaders },
          { filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'CONTAINS_TOKEN', value: domain }] }], properties: props, limit: 5 }));
      }

      const results = await Promise.all(searches);
      const allResults = results.flatMap(r => r.body.results || []);
      const seen = {};
      const unique = allResults.filter(r => { if (seen[r.id]) return false; seen[r.id] = true; return true; });
      return res.json({ total: unique.length, results: unique, coreKeyword });
    } catch (e) {
      return res.status(500).json({ error: 'HubSpot Fehler: ' + e.message });
    }
  }

  // ── INSTA PROFILE ──
  if (action === 'instaProfile') {
    const { username } = payload;
    if (!username) return res.status(400).json({ error: 'username fehlt' });

    try {
      const pageRes = await httpsGet({
        hostname: 'www.instagram.com',
        path: '/' + encodeURIComponent(username) + '/',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'de-DE,de;q=0.9'
        }
      });

      let name = username, avatar = null, bio = null, followers = null, posts = null;
      if (pageRes.status === 200) {
        const html = pageRes.buffer.toString('utf8').substring(0, 150000);
        const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
        if (titleMatch) name = titleMatch[1].replace(/\s*\(@[^)]+\)\s*/, '').replace(/\s*•.*$/, '').trim() || username;
        const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
        if (imgMatch) avatar = imgMatch[1].replace(/&amp;/g, '&');
        const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (descMatch) {
          const desc = descMatch[1];
          const fm = desc.match(/([\d,.]+[KMk]?)\s+Follower/i);
          const pm = desc.match(/([\d,.]+)\s+Beiträge/i) || desc.match(/([\d,.]+)\s+posts/i);
          if (fm) followers = fm[1];
          if (pm) posts = pm[1];
          bio = desc.replace(/[\d,.]+ Follower.*?[-–]\s*/i, '').trim().substring(0, 80) || null;
        }
      }

      // Proxy avatar
      let avatarProxy = null;
      if (avatar) {
        try {
          const url = new URL(avatar);
          const avRes = await httpsGet({ hostname: url.hostname, path: url.pathname + url.search, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.instagram.com/' } });
          if (avRes.status === 200) {
            avatarProxy = 'data:' + (avRes.headers['content-type'] || 'image/jpeg') + ';base64,' + avRes.buffer.toString('base64');
          }
        } catch {}
      }

      return res.json({ name, username, avatar: avatarProxy, bio, followers, posts });
    } catch (e) {
      return res.status(500).json({ error: 'Instagram Fehler: ' + e.message });
    }
  }

  // ── INSTA SEARCH ──
  if (action === 'instaSearch') {
    const { query } = payload;
    if (!query || query.length < 2) return res.json({ users: [] });

    try {
      const userRecord = db.findOne('users', u => u.id === req.user.id);
      const igSession = userRecord?.instagram_session || null;
      const igHeaders = {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; de_DE; 458229258)',
        'X-IG-App-ID': '936619743392459',
        'Accept': 'application/json',
        'Accept-Language': 'de-DE,de;q=0.9'
      };
      if (igSession) igHeaders['Cookie'] = `sessionid=${igSession}`;

      const searchRes = await httpsGet({
        hostname: 'i.instagram.com',
        path: '/api/v1/users/search/?q=' + encodeURIComponent(query) + '&count=8',
        headers: igHeaders
      });

      if (searchRes.status !== 200) return res.json({ users: [] });

      let body;
      try { body = JSON.parse(searchRes.buffer.toString('utf8')); } catch { return res.json({ users: [] }); }

      const users = (body.users || []).map(u => ({
        username: u.username,
        name: u.full_name || u.username,
        avatar: u.profile_pic_url || null,
        followers: u.follower_count ? (u.follower_count >= 1000 ? Math.round(u.follower_count / 100) / 10 + 'K' : u.follower_count) : null,
        verified: u.is_verified || false
      }));

      return res.json({ users, authenticated: !!igSession });
    } catch (e) {
      return res.json({ users: [], authenticated: false });
    }
  }

  // ── UPDATE OWNER ──
  if (action === 'updateOwner') {
    if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert' });
    const { companyId, ownerId } = payload;

    async function patchHubSpot(path, body) {
      const bodyStr = JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.hubapi.com', path, method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HS_KEY, 'Content-Length': Buffer.byteLength(bodyStr) }
        }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => { try { resolve({ status: r.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: r.statusCode, body: {} }); } });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
      });
    }

    try {
      const compRes = await patchHubSpot('/crm/v3/objects/companies/' + companyId, { properties: { hubspot_owner_id: String(ownerId) } });
      if (compRes.status !== 200) return res.status(500).json({ error: 'Company Update Fehler' });

      const assocRes = await httpsGet({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/' + companyId + '/associations/deals', headers: { 'Authorization': 'Bearer ' + HS_KEY } });
      const assocData = JSON.parse(assocRes.buffer.toString('utf8'));
      const dealIds = (assocData.results || []).map(d => d.id);
      let dealsUpdated = 0;
      for (const dealId of dealIds) {
        try { await patchHubSpot('/crm/v3/objects/deals/' + dealId, { properties: { hubspot_owner_id: String(ownerId) } }); dealsUpdated++; } catch {}
      }
      return res.json({ success: true, dealsUpdated });
    } catch (e) {
      return res.status(500).json({ error: 'Update Fehler: ' + e.message });
    }
  }

  // ── CREATE COMPANY ──
  if (action === 'createCompany') {
    if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert' });
    const { name, ownerId, description, website, instagram } = payload;
    const props = { name, country: 'Germany', hubspot_owner_id: String(ownerId) };
    const descParts = ['Lead via Instagram.', 'Salesperson: ' + (description || '').replace('Lead via Instagram. Salesperson: ', '')];
    if (instagram) descParts.push('Instagram: https://www.instagram.com/' + instagram);
    props.description = descParts.join(' ');
    if (website) { props.website = website; props.domain = website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; }

    try {
      const result = await httpsRequest({
        hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HS_KEY }
      }, { properties: props });
      if (result.status !== 201) return res.status(500).json({ error: 'Company Fehler: ' + JSON.stringify(result.body) });
      return res.json(result.body);
    } catch (e) {
      return res.status(500).json({ error: 'Company Fehler: ' + e.message });
    }
  }

  // ── CREATE DEAL ──
  if (action === 'createDeal') {
    if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert' });
    const { companyName, companyId, ownerId } = payload;
    try {
      const result = await httpsRequest({
        hostname: 'api.hubapi.com', path: '/crm/v3/objects/deals', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HS_KEY }
      }, {
        properties: { dealname: companyName + ' (INSTA)', pipeline: '1073833178', dealstage: '1487657147', hubspot_owner_id: String(ownerId) },
        associations: [{ to: { id: parseInt(companyId, 10) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 341 }] }]
      });
      if (result.status !== 201) return res.status(500).json({ error: 'Deal Fehler: ' + JSON.stringify(result.body) });
      return res.json(result.body);
    } catch (e) {
      return res.status(500).json({ error: 'Deal Fehler: ' + e.message });
    }
  }

  // ── CALLLIST ──
  if (action === 'calllist') {
    if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert' });
    const { ownerId, limit = 20 } = payload;
    if (!ownerId) return res.status(400).json({ error: 'Salesperson auswählen' });
    const want = Math.min(parseInt(limit) || 20, 100);

    // Return cached result if fresh (15 min per owner+limit)
    const cacheKey = `calllist_${ownerId}_${want}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    try {
      const hsHeaders = { 'Authorization': 'Bearer ' + HS_KEY };
      const hsJson   = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + HS_KEY };

      // Portal ID — cached 24h
      let portalId = cacheGet('portalId');
      if (!portalId) {
        const accRes = await httpsGet({ hostname: 'api.hubapi.com', path: '/account-info/v3/details', headers: hsHeaders }).catch(() => null);
        portalId = accRes ? (JSON.parse(accRes.buffer.toString('utf8')).portalId || null) : null;
        if (portalId) cacheSet('portalId', portalId, 24 * 60 * 60 * 1000);
      }

      // Excluded stage IDs — cached 1h
      let excludedStageIds = cacheGet('excludedStageIds');
      if (!excludedStageIds) {
        excludedStageIds = new Set();
        const pipeRes = await httpsGet({ hostname: 'api.hubapi.com', path: '/crm/v3/pipelines/deals', headers: hsHeaders }).catch(() => null);
        if (pipeRes) {
          const pipelines = JSON.parse(pipeRes.buffer.toString('utf8')).results || [];
          for (const p of pipelines) {
            const pLabel = (p.label || '').toLowerCase();
            if (pLabel.includes('cold') || pLabel.includes('hot')) {
              for (const stage of (p.stages || [])) {
                const sLabel = (stage.label || '').toLowerCase();
                if (
                  sLabel.includes('closed lost') || sLabel.includes('close lost') ||
                  sLabel.includes('lost before design') ||
                  (stage.metadata?.isClosed === 'true' && stage.metadata?.probability === '0.0')
                ) excludedStageIds.add(stage.id);
              }
            }
          }
        }
        cacheSet('excludedStageIds', excludedStageIds, 60 * 60 * 1000);
      }

      // Build filter groups for excluded deals
      const filterGroups = [
        { filters: [{ propertyName: 'hs_is_closed_lost', operator: 'EQ', value: 'true' },
                    { propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) }] }
      ];
      for (const stageId of excludedStageIds) {
        filterGroups.push({ filters: [
          { propertyName: 'dealstage', operator: 'EQ', value: stageId },
          { propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) }
        ]});
      }

      // Excluded company IDs — cached 15 min per owner
      let excludedCompanyIds = cacheGet(`excludedCo_${ownerId}`);
      if (!excludedCompanyIds) {
        excludedCompanyIds = new Set();
        let exAfter, exPages = 0;
        while (exPages < 5) {
          exPages++;
          const exBody = { filterGroups, properties: ['dealname'], limit: 100 };
          if (exAfter) exBody.after = exAfter;
          const exRes = await httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/deals/search', method: 'POST', headers: hsJson }, exBody);
          const exDeals = exRes.body.results || [];
          if (!exDeals.length) break;
          await Promise.all(exDeals.map(async d => {
            try {
              const r = await httpsGet({ hostname: 'api.hubapi.com', path: `/crm/v3/objects/deals/${d.id}/associations/companies`, headers: hsHeaders });
              (JSON.parse(r.buffer.toString('utf8')).results || []).forEach(a => excludedCompanyIds.add(a.id));
            } catch {}
          }));
          exAfter = exRes.body.paging?.next?.after;
          if (!exAfter) break;
        }
        cacheSet(`excludedCo_${ownerId}`, excludedCompanyIds, 15 * 60 * 1000);
      }

      // Fetch companies, then resolve contacts in parallel batches
      const entries = [];
      let after, total = 0, pages = 0;

      outer: while (entries.length < want && pages < 10) {
        pages++;
        const body = {
          filterGroups: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: String(ownerId) }] }],
          properties: ['name', 'website', 'notes_last_contacted'],
          sorts: [{ propertyName: 'notes_last_contacted', direction: 'ASCENDING' }],
          limit: 100
        };
        if (after) body.after = after;

        const companiesRes = await httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/companies/search', method: 'POST', headers: hsJson }, body);
        const companies = (companiesRes.body.results || []).filter(c => !excludedCompanyIds.has(c.id));
        total = companiesRes.body.total || total;
        if (!companies.length) break;

        // Fetch all contact associations in parallel
        const assocResults = await Promise.all(companies.map(c =>
          httpsGet({ hostname: 'api.hubapi.com', path: `/crm/v3/objects/companies/${c.id}/associations/contacts`, headers: hsHeaders })
            .then(r => ({ c, ids: (JSON.parse(r.buffer.toString('utf8')).results || []).map(x => x.id) }))
            .catch(() => ({ c, ids: [] }))
        ));

        // Batch-fetch all contacts at once
        const allContactIds = [...new Set(assocResults.flatMap(x => x.ids))];
        let contactMap = {};
        if (allContactIds.length) {
          const BATCH = 100;
          const batches = [];
          for (let i = 0; i < allContactIds.length; i += BATCH) batches.push(allContactIds.slice(i, i + BATCH));
          const batchResults = await Promise.all(batches.map(ids =>
            httpsRequest({ hostname: 'api.hubapi.com', path: '/crm/v3/objects/contacts/batch/read', method: 'POST', headers: hsJson },
              { inputs: ids.map(id => ({ id })), properties: ['firstname', 'lastname', 'phone', 'mobilephone'] })
              .then(r => r.body.results || []).catch(() => [])
          ));
          for (const ct of batchResults.flat()) contactMap[ct.id] = ct;
        }

        for (const { c, ids } of assocResults) {
          if (entries.length >= want) break outer;
          for (const ctId of ids) {
            const ct = contactMap[ctId];
            if (!ct) continue;
            const phone = ct.properties.mobilephone || ct.properties.phone;
            if (!phone) continue;
            entries.push({
              companyId: c.id,
              companyName: c.properties.name || null,
              contactName: [ct.properties.firstname, ct.properties.lastname].filter(Boolean).join(' ') || null,
              phone,
              website: c.properties.website || null,
              hsUrl: portalId ? `https://app.hubspot.com/contacts/${portalId}/company/${c.id}` : null,
              lastContacted: c.properties.notes_last_contacted || null,
            });
            if (entries.length >= want) break outer;
          }
        }

        after = companiesRes.body.paging?.next?.after;
        if (!after) break;
      }

      const result = { entries, total };
      cacheSet(cacheKey, result, 15 * 60 * 1000);
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'HubSpot Fehler: ' + e.message });
    }
  }

  // ── WEEKLY CALL LIST ──
  if (action === 'calllist_week_get') {
    const list = db.findOne('calllist_week', r => r.user_id === req.user.id);
    return res.json({ entries: list?.entries || [] });
  }

  if (action === 'calllist_week_save') {
    const { entry } = payload;
    if (!entry?.companyId) return res.status(400).json({ error: 'entry.companyId fehlt' });
    let list = db.findOne('calllist_week', r => r.user_id === req.user.id);
    if (!list) list = db.insert('calllist_week', { user_id: req.user.id, entries: [] });
    if (!list.entries.find(e => e.companyId === entry.companyId)) {
      list.entries.push({ ...entry, addedAt: new Date().toISOString() });
      db.update('calllist_week', list.id, { entries: list.entries });
    }
    return res.json({ ok: true, entries: list.entries });
  }

  if (action === 'calllist_week_remove') {
    const { companyId } = payload;
    const list = db.findOne('calllist_week', r => r.user_id === req.user.id);
    if (list) {
      const entries = list.entries.filter(e => e.companyId !== companyId);
      db.update('calllist_week', list.id, { entries });
      return res.json({ ok: true, entries });
    }
    return res.json({ ok: true, entries: [] });
  }

  if (action === 'calllist_week_clear') {
    const list = db.findOne('calllist_week', r => r.user_id === req.user.id);
    if (list) db.update('calllist_week', list.id, { entries: [] });
    return res.json({ ok: true });
  }

  return res.status(400).json({ error: 'Unbekannte action: ' + action });
});

module.exports = router;
