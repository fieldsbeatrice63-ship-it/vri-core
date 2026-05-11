const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// ENVIRONMENT CHECK
// =====================================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    system: "VRI Verification & Risk Infrastructure",
    status: "ONLINE",
    halo: "ACTIVE",
    shiftguard: "CONNECTED",
    backend: "RENDER",
    supabase_connected: Boolean(supabaseUrl && supabaseServiceKey)
  });
});

// =====================================================
// SAFE ENVIRONMENT DIAGNOSTIC — DOES NOT SHOW SECRETS
// =====================================================

app.get("/debug-env", (req, res) => {
  res.json({
    supabase_url_loaded: Boolean(supabaseUrl),
    service_role_loaded: Boolean(supabaseServiceKey),
    supabase_url_preview: supabaseUrl
      ? supabaseUrl.substring(0, 30) + "..."
      : "MISSING"
  });
});

// =====================================================
// CORE VRI VERIFICATION HANDLER
// =====================================================

async function runVriVerification(payload) {
  const {
    api_key,
    actor_name,
    department,
    action,
    risk_level
  } = payload;

  if (!api_key) {
    return {
      httpStatus: 401,
      body: {
        status: "DENIED",
        message: "Missing API key"
      }
    };
  }

  // =====================================================
  // VALIDATE API KEY
  // =====================================================

  const { data: validKey, error: keyError } = await supabase
    .from("api_keys")
    .select("*")
    .eq("api_key", api_key)
    .eq("status", "ACTIVE")
    .single();

  if (keyError || !validKey) {
    return {
      httpStatus: 401,
      body: {
        status: "DENIED",
        message: "Invalid or inactive API key",
        supabase_error: keyError ? keyError.message : null
      }
    };
  }

  // =====================================================
  // GENERATE IDS
  // =====================================================

  const timestamp = Date.now();
  const proof_id = "VRI-" + timestamp;
  const execution_id = "EXEC-" + timestamp;

  // =====================================================
  // HALO GOVERNANCE LOGIC
  // =====================================================

  const normalizedRisk = (risk_level || "").toUpperCase();

  let execution_state = "APPROVED";
  let supervisor_required = false;

  if (normalizedRisk === "HIGH") {
    execution_state = "ESCALATED";
    supervisor_required = true;
  }

  // =====================================================
  // INSERT EXECUTION SESSION
  // =====================================================

  const { data: sessionData, error: sessionError } = await supabase
    .from("execution_sessions")
    .insert([
      {
        proof_id,
        execution_id,
        actor_name,
        department,
        action,
        risk_level: normalizedRisk,
        execution_state
      }
    ])
    .select();

  if (sessionError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "execution_sessions insert failed",
        supabase_error: sessionError.message,
        details: sessionError
      }
    };
  }

  // =====================================================
  // INSERT VERIFICATION EVENT
  // =====================================================

  const { data: eventData, error: eventError } = await supabase
    .from("verification_events")
    .insert([
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "API_VERIFICATION",
        status: execution_state
      }
    ])
    .select();

  if (eventError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "verification_events insert failed",
        supabase_error: eventError.message,
        details: eventError
      }
    };
  }
    // =====================================================
  // INSERT ESCALATION RECORD IF REQUIRED
  // =====================================================

  let escalationData = null;

  if (execution_state === "ESCALATED") {
    const { data: savedEscalation, error: escalationError } = await supabase
      .from("execution_escalations")
      .insert([
        {
          proof_id,
          execution_id,
          actor_name,
          department,
          action,
          risk_level: normalizedRisk,
          escalation_status: "OPEN",
          supervisor_required: true
        }
      ])
      .select();

    if (escalationError) {
      return {
        httpStatus: 500,
        body: {
          status: "ERROR",
          message: "execution_escalations insert failed",
          supabase_error: escalationError.message,
          details: escalationError
        }
      };
    }

    escalationData = savedEscalation;
  }

  // =====================================================
  // RETURN GOVERNED RESPONSE
  // =====================================================

  return {
    httpStatus: 200,
    body: {
      status: "VERIFIED",
      organization: validKey.organization_name,
      proof_id,
      execution_id,
      execution_state,
      halo_status: "ACTIVE",
      supervisor_required,
      audit_locked: true,
     database_writes: {
  execution_sessions: "SAVED",
  verification_events: "SAVED",
  execution_escalations:
    execution_state === "ESCALATED"
      ? "SAVED"
      : "NOT_REQUIRED"
},

saved_records: {
  execution_session: sessionData,
  verification_event: eventData,
  escalation: escalationData
}
    }
  };
}

// =====================================================
// VRI ENTERPRISE VERIFICATION API
// =====================================================

app.post("/api/vri/verify", async (req, res) => {
  try {
    const result = await runVriVerification(req.body);
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error("VRI API ERROR:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "VRI infrastructure failure",
      error: error.message
    });
  }
});

// =====================================================
// VRI AUDIT RETRIEVAL API
// =====================================================

app.get("/api/vri/audit/:proof_id", async (req, res) => {
  try {
    const { proof_id } = req.params;

    if (!proof_id) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing proof_id"
      });
    }

    const { data: verificationEvents, error: verificationError } = await supabase
      .from("verification_events")
      .select("*")
      .eq("proof_id", proof_id)
      .order("created_at", { ascending: false });

    if (verificationError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load verification events",
        supabase_error: verificationError.message
      });
    }

    const { data: executionSessions, error: executionError } = await supabase
      .from("execution_sessions")
      .select("*")
      .eq("proof_id", proof_id)
      .order("execution_started_at", { ascending: false });

    if (executionError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load execution sessions",
        supabase_error: executionError.message
      });
    }

    const { data: escalations, error: escalationError } = await supabase
      .from("execution_escalations")
      .select("*")
      .eq("proof_id", proof_id)
      .order("created_at", { ascending: false });

    if (escalationError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load escalation records",
        supabase_error: escalationError.message
      });
    }

    return res.json({
      status: "AUDIT_FOUND",
      proof_id,
      audit_locked: true,
      halo_status: "ACTIVE",
      verification_events: verificationEvents || [],
      execution_sessions: executionSessions || [],
      escalations: escalations || [],
      audit_summary: {
        verification_event_count: verificationEvents ? verificationEvents.length : 0,
        execution_session_count: executionSessions ? executionSessions.length : 0,
        escalation_count: escalations ? escalations.length : 0
      }
    });

  } catch (error) {
    console.error("VRI AUDIT API ERROR:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Audit retrieval failed",
      error: error.message
    });
  }
});
// =====================================================
// BROWSER TEST ROUTE
// =====================================================

app.get("/test-vri", async (req, res) => {
  try {
    const testPayload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Nurse A",
      department: "ICU",
      action: "Controlled Medication Override",
      risk_level: "HIGH"
    };

    const result = await runVriVerification(testPayload);
    return res.status(result.httpStatus).json(result.body);

  } catch (error) {
    console.error("TEST VRI ERROR:", error);

    return res.status(500).json({
      status: "FAILED",
      message: "Test route failed",
      error: error.message
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`VRI API infrastructure running on port ${PORT}`);
});
