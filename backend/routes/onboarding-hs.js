const router = require('express').Router();
const https = require('https');
const { authenticate } = require('../middleware/auth');

const STAGE_LABELS = {
  '1487657147': 'Qualification', '418155464': 'Qualification',
  '1487268036': 'Pre-Onboarding', '705458930': 'Pre-Onboarding',
  '4793537736': 'Onboarding', '4958905581': 'Onboarding',
  '1487657152': 'Won', '418155469': 'Won',
  '1487268037': 'To Brandhub', '418155461': 'To Brandhub',
};
const PIPELINE_LABELS = {
  '1073833178': 'DE Cold Sales',
  '250370754': 'NL Pipeline',
};

function hsRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.hubapi.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg = parsed?.message || parsed?.error || `HTTP ${res.statusCode}`;
          const err = new Error(msg);
          err.status = res.statusCode;
          return reject(err);
        }
        resolve(parsed);
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('HubSpot Timeout (15s)')));
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

router.post('/', authenticate, async (req, res) => {
  const HS_KEY = process.env.HUBSPOT_TOKEN || process.env.HS_TOKEN || process.env.HUBSPOT_API_KEY;
  if (!HS_KEY) return res.status(500).json({ error: 'HUBSPOT_TOKEN nicht konfiguriert (bitte in Railway Variables setzen)' });

  const { action, ...payload } = req.body;
  if (!action) return res.status(400).json({ error: 'action fehlt' });

  const hs = (method, path, body) => hsRequest(method, path, body, HS_KEY);

  try {
    // ── GET DEAL BY ID ──
    if (action === 'getDealById') {
      const { dealId } = payload;
      const d = await hs('GET', `/crm/v3/objects/deals/${dealId}?properties=dealname,dealstage,pipeline,hubspot_owner_id`);

      let company = null, companyId = null;
      try {
        const assoc = await hs('GET', `/crm/v3/objects/deals/${dealId}/associations/companies`);
        if (assoc.results?.length > 0) {
          companyId = assoc.results[0].id;
          const comp = await hs('GET', `/crm/v3/objects/companies/${companyId}?properties=name`);
          company = comp.properties?.name || null;
        }
      } catch {}

      return res.json({
        id: d.id,
        name: d.properties.dealname || '(kein Name)',
        stage: STAGE_LABELS[d.properties.dealstage] || d.properties.dealstage,
        pipeline: PIPELINE_LABELS[d.properties.pipeline] || d.properties.pipeline,
        pipelineId: d.properties.pipeline,
        currentOwnerId: d.properties.hubspot_owner_id || null,
        company, companyId,
      });
    }

    // ── SET NB CREDITS ──
    if (action === 'setNbCredits') {
      const { companyId, ownerId } = payload;
      if (!companyId) return res.status(400).json({ error: 'Keine Company mit diesem Deal verknüpft' });
      await hs('PATCH', `/crm/v3/objects/companies/${companyId}`, { properties: { new_business_company_owner: ownerId } });
      return res.json({ ok: true });
    }

    // ── UPDATE DEAL STAGE ──
    if (action === 'updateDealStage') {
      const { dealId, stage } = payload;
      await hs('PATCH', `/crm/v3/objects/deals/${dealId}`, { properties: { dealstage: stage } });
      return res.json({ ok: true });
    }

    // ── CREATE NOTE ──
    if (action === 'createNote') {
      const { dealId, companyId, body: noteBody, ownerId } = payload;
      const note = await hs('POST', '/crm/v3/objects/notes', {
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
          hubspot_owner_id: ownerId,
        },
        associations: [
          { to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
          ...(companyId ? [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }] : []),
        ],
      });
      return res.json({ ok: true, noteId: note.id });
    }

    // ── UPDATE OWNER ──
    if (action === 'updateOwner') {
      const { dealId, companyId, ownerId } = payload;
      await hs('PATCH', `/crm/v3/objects/deals/${dealId}`, { properties: { hubspot_owner_id: ownerId } });
      if (companyId) {
        await hs('PATCH', `/crm/v3/objects/companies/${companyId}`, { properties: { hubspot_owner_id: ownerId } });
      }
      return res.json({ ok: true });
    }

    // ── SEARCH DEALS BY COMPANY NAME ──
    if (action === 'searchDealsByCompany') {
      const { companyName } = payload;
      const compSearch = await hs('POST', '/crm/v3/objects/companies/search', {
        filterGroups: [{ filters: [{ propertyName: 'name', operator: 'CONTAINS_TOKEN', value: companyName }] }],
        properties: ['name'], limit: 5,
      });
      const companies = compSearch.results || [];
      if (!companies.length) return res.json({ deals: [] });

      const companyId = companies[0].id;
      const companyNameFull = companies[0].properties?.name || companyName;
      let deals = [];
      try {
        const assoc = await hs('GET', `/crm/v3/objects/companies/${companyId}/associations/deals`);
        const dealIds = (assoc.results || []).map(r => r.id);
        if (dealIds.length) {
          const batchRes = await hs('POST', '/crm/v3/objects/deals/batch/read', {
            inputs: dealIds.map(id => ({ id })),
            properties: ['dealname', 'dealstage', 'pipeline', 'amount'],
          });
          deals = (batchRes.results || []).map(d => ({
            id: d.id,
            name: d.properties?.dealname || '(kein Name)',
            stage: STAGE_LABELS[d.properties?.dealstage] || d.properties?.dealstage,
            pipeline: PIPELINE_LABELS[d.properties?.pipeline] || d.properties?.pipeline,
            amount: d.properties?.amount ? Number(d.properties.amount) : null,
          }));
        }
      } catch {}
      return res.json({ deals, companyId, companyName: companyNameFull });
    }

    if (action === 'getDealsByCompanyId') {
      const { companyId } = payload;
      if (!companyId) return res.status(400).json({ error: 'companyId fehlt' });
      const company = await hs('GET', `/crm/v3/objects/companies/${companyId}?properties=name`);
      const companyName = company.properties?.name || '';
      let deals = [];
      try {
        const assoc = await hs('GET', `/crm/v3/objects/companies/${companyId}/associations/deals`);
        const dealIds = (assoc.results || []).map(r => r.id);
        if (dealIds.length) {
          const batchRes = await hs('POST', '/crm/v3/objects/deals/batch/read', {
            inputs: dealIds.map(id => ({ id })),
            properties: ['dealname', 'dealstage', 'pipeline', 'amount'],
          });
          deals = (batchRes.results || []).map(d => ({
            id: d.id,
            name: d.properties?.dealname || '(kein Name)',
            stage: STAGE_LABELS[d.properties?.dealstage] || d.properties?.dealstage,
            pipeline: PIPELINE_LABELS[d.properties?.pipeline] || d.properties?.pipeline,
            amount: d.properties?.amount ? Number(d.properties.amount) : null,
          }));
        }
      } catch {}
      return res.json({ deals, companyId, companyName });
    }

    // ── CHECK LEAD URL (duplicate detection) ──
    if (action === 'checkLeadUrl') {
      const { url } = payload;
      if (!url) return res.status(400).json({ error: 'URL erforderlich' });
      const domain = String(url).trim().replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase();
      if (!domain) return res.json({ matches: [] });
      const searchBody = {
        filterGroups: [
          { filters: [{ propertyName: 'domain',  operator: 'CONTAINS_TOKEN', value: domain }] },
          { filters: [{ propertyName: 'website', operator: 'CONTAINS_TOKEN', value: domain }] },
        ],
        properties: ['name', 'website', 'domain', 'hubspot_owner_id'],
        limit: 5,
      };
      const r = await hs('POST', '/crm/v3/objects/companies/search', searchBody);
      const matches = (r.results || []).map(c => ({
        id: c.id,
        name: c.properties.name || '(ohne Name)',
        website: c.properties.website || null,
        domain: c.properties.domain || null,
        ownerId: c.properties.hubspot_owner_id || null,
      }));
      return res.json({ matches });
    }

    // ── CREATE LEAD (Contact + Company + Deal) ──
    if (action === 'createLead') {
      const { firma, url, contactName, email, phone, pipeline, ownerId, notes } = payload;
      if (!firma || !contactName) return res.status(400).json({ error: 'Firma und Kontaktperson erforderlich' });
      if (!url) return res.status(400).json({ error: 'URL erforderlich' });
      if (!ownerId) return res.status(400).json({ error: 'Salesperson erforderlich' });
      const ownerStr = String(ownerId);

      // 1. Create Company
      const companyProps = { name: firma, website: url, hubspot_owner_id: ownerStr };
      const domainExtracted = String(url).trim().replace(/^https?:\/\/(www\.)?/i, '').split('/')[0].toLowerCase();
      if (domainExtracted) companyProps.domain = domainExtracted;
      const company = await hs('POST', '/crm/v3/objects/companies', { properties: companyProps });
      const companyId = company.id;

      // 2. Create Contact
      const [firstName, ...lastParts] = contactName.trim().split(' ');
      const contactProps = { firstname: firstName, lastname: lastParts.join(' ') || '', hubspot_owner_id: ownerStr };
      if (email) contactProps.email = email;
      if (phone) contactProps.phone = phone;
      const contact = await hs('POST', '/crm/v3/objects/contacts', { properties: contactProps });
      const contactId = contact.id;

      // 3. Associate Contact → Company
      await hs('PUT', `/crm/v3/objects/contacts/${contactId}/associations/companies/${companyId}/contact_to_company`, null);

      // 4. Create Deal in Qualification stage
      const QUAL_STAGES = { '1073833178': '1487657147', '250370754': '418155464' };
      const dealStage = QUAL_STAGES[pipeline] || '1487657147';
      const dealProps = { dealname: firma, pipeline, dealstage: dealStage, hubspot_owner_id: ownerStr };
      if (notes) dealProps.description = notes;
      const deal = await hs('POST', '/crm/v3/objects/deals', { properties: dealProps });
      const dealId = deal.id;

      // 5. Associate Deal → Company + Contact
      await hs('PUT', `/crm/v3/objects/deals/${dealId}/associations/companies/${companyId}/deal_to_company`, null);
      await hs('PUT', `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`, null);

      // 6. Add note if provided
      if (notes) {
        try {
          await hs('POST', '/crm/v3/objects/notes', {
            properties: { hs_note_body: notes, hs_timestamp: new Date().toISOString() },
            associations: [
              { to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] },
              { to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] },
            ],
          });
        } catch {}
      }

      return res.json({ ok: true, companyId, contactId, dealId });
    }

    return res.status(400).json({ error: 'Unbekannte action: ' + action });

  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
