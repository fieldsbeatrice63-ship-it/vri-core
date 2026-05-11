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
        verification_events: "SAVED"
      },
      saved_records: {
        execution_session: sessionData,
        verification_event: eventData
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
