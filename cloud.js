(function () {
  const CONFIG_ENDPOINT = "/.netlify/functions/config";
  const DEFAULT_CONFIG = {
    supabaseUrl: "https://sexiqhmgdiasjvwbptpa.supabase.co",
    supabaseAnonKey: "sb_publishable_6lKnpCwYrCC0NrHOzT5QWQ_JntmZ7L5"
  };
  let client = null;
  let userId = null;

  function cleanState(value) {
    return {
      settings: { appName: value?.settings?.appName || "FitFlow" },
      profile: value?.profile || null,
      trainings: Array.isArray(value?.trainings) ? value.trainings : [],
      foods: Array.isArray(value?.foods) ? value.foods : [],
      weights: Array.isArray(value?.weights) ? value.weights : []
    };
  }

  async function readConfig() {
    try {
      const response = await fetch(CONFIG_ENDPOINT, { cache: "no-store" });
      if (!response.ok) return DEFAULT_CONFIG;
      const configured = await response.json();
      return configured.supabaseUrl && configured.supabaseAnonKey ? configured : DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async function ensureAnonymousSession() {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session) return sessionData.session;

    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
  }

  async function initialize() {
    if (!window.supabase?.createClient) {
      return { enabled: false, reason: "云数据库组件未加载" };
    }

    try {
      const config = await readConfig();
      if (!config.supabaseUrl || !config.supabaseAnonKey) {
        return { enabled: false, reason: "云数据库尚未配置" };
      }

      client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });

      const session = await ensureAnonymousSession();
      userId = session?.user?.id || null;
      if (!userId) throw new Error("无法建立匿名设备身份");

      const { data, error } = await client.rpc("get_fitflow_state");
      if (error) throw error;

      return {
        enabled: true,
        userId,
        state: cleanState(data)
      };
    } catch (error) {
      console.warn("FitFlow cloud unavailable:", error);
      client = null;
      userId = null;
      return { enabled: false, reason: error.message || "云端连接失败" };
    }
  }

  async function save(state) {
    if (!client || !userId) throw new Error("云数据库尚未连接");
    const { error } = await client.rpc("save_fitflow_state", {
      input_state: cleanState(structuredClone(state))
    });
    if (error) throw error;
  }

  window.fitflowCloud = {
    initialize,
    save,
    isConnected: () => Boolean(client && userId),
    getUserId: () => userId
  };
})();
