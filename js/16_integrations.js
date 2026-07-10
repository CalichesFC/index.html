    // ============================================================
    // EXTERNAL INTEGRATIONS FRAMEWORK  (js/16) — DORMANT SCAFFOLDING.
    // ------------------------------------------------------------
    // Purpose: give the Hub a ready-to-wire home for outside services
    // (social scheduling, email, POS) BEFORE those accounts exist.
    // Nothing here is surfaced in the UI and nothing makes a network
    // call. Every adapter reports "not configured" and every dispatch
    // is an inert no-op until (a) an adapter is flipped enabled AND
    // (b) its credentials are provided out-of-band (server side /
    // Edge Function secrets — never in this file, never in the client).
    //
    // When a real integration is ready, the ONLY changes needed are:
    //   1. set enabled:true on its adapter (or via app_settings group
    //      'integrations', key '<id>__enabled' = 'true'),
    //   2. implement its send()/import() to call a server Edge Function
    //      that holds the secret (client stays key-free),
    //   3. optionally add an admin toggle — the status registry below
    //      is already shaped for that.
    //
    // Data landing point already exists: mkt_metrics.source accepts
    // 'manual' | 'aloha' | 'hootsuite' | 'website' | 'email', so import
    // adapters have a home the moment they're switched on.
    // ============================================================

    // ---- adapter registry (categories: social | email | pos) ----
    var HUB_INTEGRATIONS = {
      hootsuite: {
        id:'hootsuite', label:'Hootsuite', category:'social', enabled:false,
        purpose:'Schedule & publish social posts; pull post metrics into mkt_metrics (source: hootsuite).',
        capabilities:['publish','schedule','import_metrics'],
        // Credentials live server-side. These are NAMES the Edge Function will read, not values.
        secretRefs:['HOOTSUITE_TOKEN'],
        endpointRef:'edge:integrations-hootsuite'
      },
      meta_graph: {
        id:'meta_graph', label:'Meta (Facebook / Instagram)', category:'social', enabled:false,
        purpose:'Direct FB/IG publishing & insight import when Hootsuite is not used.',
        capabilities:['publish','import_metrics'],
        secretRefs:['META_PAGE_TOKEN','META_IG_USER_ID'],
        endpointRef:'edge:integrations-meta'
      },
      email_broadcast: {
        id:'email_broadcast', label:'Email Broadcast (SendGrid / Mailchimp)', category:'email', enabled:false,
        purpose:'Send campaign/blast email; import open & click metrics (source: email).',
        capabilities:['send','import_metrics'],
        secretRefs:['EMAIL_PROVIDER_KEY'],
        endpointRef:'edge:integrations-email'
      },
      aloha_pos: {
        id:'aloha_pos', label:'Aloha POS (NCR)', category:'pos', enabled:false,
        purpose:'Batch import daily sales/labor into store_metrics & mkt_metrics (source: aloha).',
        capabilities:['import_sales','import_labor'],
        secretRefs:['ALOHA_FEED_URL','ALOHA_FEED_KEY'],
        endpointRef:'edge:integrations-aloha'
      }
    };

    // ---- is an adapter live? (local flag OR app_settings override) ----
    // Reads app_settings group 'integrations', key '<id>__enabled'. Falls
    // back to the local enabled flag. Returns false whenever cfg is absent
    // or the value isn't an explicit 'true' — so this is false everywhere today.
    function hubIntegrationConfigured(id){
      var a=HUB_INTEGRATIONS[id]; if(!a) return false;
      var flag=a.enabled===true;
      try{
        if(typeof cfg==='function'){
          var ov=cfg('integrations', id+'__enabled', null);
          if(ov!=null) flag=(String(ov).toLowerCase()==='true');
        }
      }catch(e){}
      return !!flag;
    }

    // ---- status registry (shaped for a future admin panel) ----
    function hubIntegrationStatus(){
      return Object.keys(HUB_INTEGRATIONS).map(function(id){
        var a=HUB_INTEGRATIONS[id];
        return { id:a.id, label:a.label, category:a.category,
                 live:hubIntegrationConfigured(id),
                 capabilities:a.capabilities.slice(), purpose:a.purpose };
      });
    }

    // ---- outbound dispatch (publish / send) — inert until wired ----
    // Returns a Promise resolving to a uniform result object. Never throws,
    // never calls the network while adapters are dormant.
    function hubIntegrationDispatch(id, action, payload){
      return new Promise(function(resolve){
        var a=HUB_INTEGRATIONS[id];
        if(!a){ resolve({ ok:false, id:id, reason:'unknown_adapter' }); return; }
        if(!hubIntegrationConfigured(id)){ resolve({ ok:false, id:id, reason:'not_configured' }); return; }
        if(a.capabilities.indexOf(action)<0){ resolve({ ok:false, id:id, reason:'unsupported_action', action:action }); return; }
        // REAL WIRING GOES HERE (call the Edge Function named a.endpointRef,
        // which holds the secret). Intentionally not implemented while dormant.
        resolve({ ok:false, id:id, reason:'not_implemented', action:action, endpoint:a.endpointRef });
      });
    }

    // ---- inbound import (metrics/sales) — inert until wired ----
    function hubIntegrationImport(id, since){
      return new Promise(function(resolve){
        if(!hubIntegrationConfigured(id)){ resolve({ ok:false, id:id, reason:'not_configured' }); return; }
        // REAL WIRING: server pulls provider data and upserts into
        // mkt_metrics/store_metrics with the matching source tag.
        resolve({ ok:false, id:id, reason:'not_implemented', since:since||null });
      });
    }

    // Expose on window for future modules/admin without eager work.
    try{
      window.HUB_INTEGRATIONS = HUB_INTEGRATIONS;
      window.hubIntegrationStatus = hubIntegrationStatus;
      window.hubIntegrationConfigured = hubIntegrationConfigured;
      window.hubIntegrationDispatch = hubIntegrationDispatch;
      window.hubIntegrationImport = hubIntegrationImport;
    }catch(e){}
    // Dormant on purpose — no auto-run, no network, no UI.
