"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  testAiProviderConnection,
  fetchAiModels,
  getAiLogs,
  getAiInsights,
} from "@/services/ai.service";
import { apiFetch } from "@/lib/api/client";
import {
  Brain,
  Plus,
  Key,
  Globe,
  Loader2,
  Trash2,
  Pencil,
  Zap,
  Activity,
  FileText,
  Download,
  Eye,
  EyeOff,
  Bug,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import Link from "next/link";

const aiProviderSchema = {
  display_name: { required: true, maxLength: 100, label: "Display name" },
  base_url: { required: true, maxLength: 255, label: "Base URL" },
  model_name: { required: true, maxLength: 100, label: "Model name" },
  temperature: { required: true, type: "positiveNumber", max: 9.99, label: "Temperature" },
  max_tokens: { required: true, type: "positiveNumber", min: 1, max: 1000000, integer: true, label: "Max tokens" },
  timeout_seconds: { required: true, type: "positiveNumber", min: 1, max: 600, integer: true, label: "Timeout (seconds)" },
  api_key: { maxLength: 2000, label: "API key" },
};

export default function AiSettingsPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModelList, setFetchedModelList] = useState([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testingInsight, setTestingInsight] = useState(false);
  const [driverTestResult, setDriverTestResult] = useState(null);
  const [testingDriverInsight, setTestingDriverInsight] = useState(false);

  const [formData, setFormData] = useState({
    name: "my-openai",
    display_name: "My OpenAI",
    provider_class: "OpenAI",
    base_url: "https://api.openai.com/v1",
    endpoint_path: "/chat/completions",
    model_name: "gpt-4o-mini",
    api_key: "",
    temperature: "0.7",
    max_tokens: "16384",
    timeout_seconds: "120",
    is_default: false,
  });
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(aiProviderSchema);

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ["ai-providers"],
    queryFn: () => getAiProviders(),
  });

  const { data: instructions } = useQuery({
    queryKey: ["ai-instructions"],
    queryFn: () => apiFetch("/api/ai/instructions"),
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["ai-logs-recent"],
    queryFn: () => getAiLogs(),
    refetchInterval: 10_000,
  });

  const activeProvider = (providers || []).find((p) => p.is_default && p.is_enabled);

  const handleTestInsightGeneration = async () => {
    setTestingInsight(true);
    setTestResult(null);
    try {
      const res = await getAiInsights();
      setTestResult({
        success: true,
        summary: res.natural_language_summary || "No LLM summary returned (rule-based only)",
        insightCount: Array.isArray(res.insights) ? res.insights.length : 0,
        raw: res,
      });
      toast.success("Insight generation completed!");
    } catch (err) {
      setTestResult({ success: false, error: err.message });
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setTestingInsight(false);
    }
  };

  const handleTestDriverInsight = async () => {
    setTestingDriverInsight(true);
    setDriverTestResult(null);
    try {
      const res = await apiFetch("/api/ai/driver-insights");
      setDriverTestResult({
        success: true,
        analysis: res.analysis || "No analysis returned",
        driverCount: res.driver_count || 0,
        llmStatus: res.llm_status || "Rule-Based",
        diagnostics: res.diagnostics || null,
      });
      toast.success("Driver insight generated!");
    } catch (err) {
      setDriverTestResult({ success: false, error: err.message });
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setTestingDriverInsight(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: createAiProvider,
    onSuccess: () => {
      toast.success("AI Provider configured successfully");
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      closeDialog();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateAiProvider(id, data),
    onSuccess: () => {
      toast.success("AI Provider updated successfully");
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
      closeDialog();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteAiProvider(id),
    onSuccess: () => {
      toast.success("AI Provider removed");
      queryClient.invalidateQueries({ queryKey: ["ai-providers"] });
    },
    onError: (err) => toast.error(err.message),
  });

  function openNewDialog() {
    setEditingProvider(null);
    setFetchedModelList([]);
    setFormData({
      name: "my-openai",
      display_name: "My OpenAI",
      provider_class: "OpenAI",
      base_url: "https://api.openai.com/v1",
      endpoint_path: "/chat/completions",
      model_name: "gpt-4o-mini",
      api_key: "",
      temperature: "0.7",
      max_tokens: "16384",
      timeout_seconds: "120",
      is_default: providers.length === 0,
    });
    setShowApiKey(false);
    resetValidation();
    setDialogOpen(true);
  }

  function openEditDialog(p) {
    setEditingProvider(p);
    setFormData({
      name: p.provider_name || "my-provider",
      display_name: p.display_name || "",
      provider_class: p.provider_name || "OpenAI",
      base_url: p.base_url || "https://api.openai.com/v1",
      endpoint_path: "/chat/completions",
      model_name: p.model_name || "gpt-4o-mini",
      api_key: p.api_key_masked || "",
      temperature: p.temperature ? String(p.temperature) : "0.7",
      max_tokens: p.max_tokens ? String(p.max_tokens) : "16384",
      timeout_seconds: p.timeout_ms ? String(Math.round(p.timeout_ms / 1000)) : "120",
      is_default: p.is_default ?? false,
    });
    setShowApiKey(false);
    resetValidation();
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingProvider(null);
    setFetchedModelList([]);
  }

  function handleSubmit(e) {
    e.preventDefault();

    const isValid = validate(formData, {
      onSuccess: () => {
        const payload = {
          provider_name: formData.provider_class,
          display_name: formData.display_name,
          base_url: formData.base_url,
          api_key: formData.api_key,
          model_name: formData.model_name,
          temperature: Number(formData.temperature),
          max_tokens: Number(formData.max_tokens),
          timeout_ms: Number(formData.timeout_seconds) * 1000,
          is_default: formData.is_default,
          is_enabled: true,
        };

        if (editingProvider) {
          updateMutation.mutate({ id: editingProvider.provider_id, data: payload });
        } else {
          createMutation.mutate(payload);
        }
      },
    });
    if (!isValid) return;
  }

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setFetchedModelList([]);
    try {
      const res = await fetchAiModels({
        base_url: formData.base_url,
        api_key: formData.api_key,
      });
      if (res.models && res.models.length > 0) {
        setFetchedModelList(res.models);
        setFormData((prev) => ({ ...prev, model_name: res.models[0] }));
        toast.success(`Fetched ${res.models.length} model(s) from provider!`);
      } else {
        toast.info("Using default model options");
      }
    } catch (err) {
      toast.error(`Fetch models notice: ${err.message}`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestConnection = async (p) => {
    setTestingId(p.provider_id);
    try {
      const res = await testAiProviderConnection(p.provider_id);
      if (res.status === "Online") {
        toast.success(`Connection to ${p.display_name} verified!`);
      } else {
        toast.error(`Connection failed: ${res.message}`);
      }
    } catch (err) {
      toast.error(`Test failed: ${err.message}`);
    } finally {
      setTestingId(null);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" /> AI Provider & Engine Management
          </h1>
          <p className="text-foreground-secondary mt-1">
            Configure LLM engines (OpenAI, Gemini, Custom), system prompts, and rule-based fallback behavior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings/ai/logs">
            <Button variant="outline" className="h-10">
              <Activity className="w-4 h-4 mr-2 text-primary" />
              View Request Logs
            </Button>
          </Link>
          <Button className="h-10" onClick={openNewDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Add Provider
          </Button>
        </div>
      </div>

      {/* ── Rule-Based Engine Banner ── */}
      <Card className="border border-primary/20 bg-primary/5 shadow-sm">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                Deterministic Rule-Based Engine <Badge variant="success" className="text-[11px]">Always Active</Badge>
              </h3>
              <p className="text-xs text-foreground-secondary mt-0.5">
                Calculates vehicle utilization, predictive maintenance risk scores, and driver dispatch matching offline with 0 API key costs.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs">Zero Cost • 100% Uptime</Badge>
        </CardContent>
      </Card>

      {/* ── Configured Providers Grid ── */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-secondary">
          Configured LLM Providers
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((p) => (
            <Card key={p.provider_id} className={`border-0 shadow-sm transition-all ${p.is_default ? "ring-2 ring-primary" : ""}`}>
              <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground text-base flex items-center gap-1.5">
                        {p.display_name}
                      </h3>
                      <p className="text-xs text-foreground-secondary font-mono mt-0.5">{p.model_name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {p.is_default && (
                        <Badge variant="default" className="text-[11px]">Default</Badge>
                      )}
                      <Badge variant={p.is_enabled ? "success" : "secondary"} className="text-[11px]">
                        {p.is_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-foreground-muted">
                    <p className="truncate flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-primary" /> {p.base_url || "Default Endpoint"}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-primary" /> {p.api_key_masked || "No API Key Set"}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs flex items-center gap-1"
                    onClick={() => handleTestConnection(p)}
                    disabled={testingId === p.provider_id}
                  >
                    {testingId === p.provider_id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-primary mr-1" />
                    )}
                    Test Connection
                  </Button>

                  <div className="flex items-center gap-1">
                    <Tooltip content="Edit Provider">
                      <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEditDialog(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Delete Provider">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-danger hover:text-danger hover:bg-danger/10"
                        onClick={() => deleteMutation.mutate(p.provider_id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {!isLoading && providers.length === 0 && (
            <Card className="border-0 shadow-sm col-span-full">
              <CardContent className="py-10 text-center text-foreground-muted">
                <Brain className="w-10 h-10 mx-auto mb-2 opacity-40 text-primary" />
                <p className="text-base font-semibold text-foreground">No LLM Providers Configured</p>
                <p className="text-xs mt-1 max-w-md mx-auto">
                  The system is currently running in <b>Deterministic Rule-Based Mode</b>. Add an AI provider (OpenAI, Gemini, Groq, DeepSeek) to enable natural-language intelligence summaries.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── System Instructions & Prompt Management ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> System Instructions & Prompt Template
            </CardTitle>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Loaded dynamically from <code className="text-primary font-mono font-bold">resources/ai/instructions.md</code>
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-mono">v1.0.0 Active</Badge>
        </CardHeader>
        <CardContent className="p-4">
          {instructions?.content ? (
            <pre className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap font-sans max-h-80 overflow-y-auto">
              {instructions.content}
            </pre>
          ) : (
            <p className="text-xs text-foreground-secondary leading-relaxed">
              Loading instructions...
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Debug Console ── */}
      <Card className="border-0 shadow-sm border border-warning/30">
        <CardHeader className="pb-3 border-b border-border flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Bug className="w-4 h-4 text-warning" /> AI Debug Console
            </CardTitle>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Verify LLM provider connectivity and insight generation
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Active provider status */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
            <div className="flex items-center gap-3">
              <div className={`p-1.5 rounded-lg ${activeProvider ? "bg-success/10" : "bg-muted"}`}>
                <Zap className={`w-4 h-4 ${activeProvider ? "text-success" : "text-foreground-muted"}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {activeProvider ? activeProvider.display_name : "No Active Provider"}
                </p>
                <p className="text-xs text-foreground-secondary">
                  {activeProvider
                    ? `${activeProvider.model_name} · ${activeProvider.base_url}`
                    : "System running in Deterministic Rule-Based mode only"}
                </p>
              </div>
            </div>
            <Badge variant={activeProvider ? "success" : "secondary"} className="text-[11px]">
              {activeProvider ? "LLM Ready" : "Rule-Based"}
            </Badge>
          </div>

          {/* Test insight generation */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Quick Tests</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestInsightGeneration}
                disabled={testingInsight}
                className="h-8 text-xs"
              >
                {testingInsight ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Generating...</>
                ) : (
                  <><Activity className="w-3.5 h-3.5 mr-1.5 text-primary" /> Test Fleet Insight</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestDriverInsight}
                disabled={testingDriverInsight}
                className="h-8 text-xs"
              >
                {testingDriverInsight ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Analyzing...</>
                ) : (
                  <><Brain className="w-3.5 h-3.5 mr-1.5 text-primary" /> Test Driver Insight</>
                )}
              </Button>
            </div>

            {/* Test result */}
            {testResult && (
              <div className={`p-3 rounded-xl text-xs font-mono leading-relaxed max-h-48 overflow-y-auto ${testResult.success ? "bg-success/5 border border-success/20" : "bg-danger/5 border border-danger/20"}`}>
                {testResult.success ? (
                  <>
                    <p className="text-success font-semibold mb-1">✓ LLM Response Received</p>
                    <p className="text-foreground-secondary whitespace-pre-wrap">{testResult.summary}</p>
                    <p className="text-foreground-muted mt-1">{testResult.insightCount} rule-based insight(s) generated</p>
                  </>
                ) : (
                  <>
                    <p className="text-danger font-semibold mb-1">✗ LLM Error</p>
                    <p className="text-danger">{testResult.error}</p>
                  </>
                )}
              </div>
            )}

            {/* Driver test result */}
            {driverTestResult && (
              <div className={`p-3 rounded-xl text-xs font-mono leading-relaxed max-h-64 overflow-y-auto ${driverTestResult.success ? "bg-primary/5 border border-primary/20" : "bg-danger/5 border border-danger/20"}`}>
                {driverTestResult.success ? (
                  <>
                    <p className="text-primary font-semibold mb-1">
                      ✓ Driver AI Analysis ({driverTestResult.llmStatus}) · {driverTestResult.driverCount} driver(s)
                    </p>
                    <p className="text-foreground-secondary whitespace-pre-wrap">{driverTestResult.analysis}</p>
                    {driverTestResult.llmStatus === "Rule-Based" && driverTestResult.diagnostics && (
                      <div className="mt-2 p-2 rounded-lg bg-muted/30 text-[11px]">
                        <p className="font-semibold text-foreground mb-1">Provider Diagnostics:</p>
                        {driverTestResult.diagnostics.providers?.length === 0 ? (
                          <p className="text-foreground-muted">No providers found in database</p>
                        ) : (
                          driverTestResult.diagnostics.providers?.map((p) => (
                            <div key={p.provider_id} className="flex items-center gap-2 text-foreground-muted">
                              <span>#{p.provider_id}</span>
                              <span className="text-foreground">{p.display_name || p.provider_name}</span>
                              <Badge variant={p.is_enabled ? "success" : "secondary"} className="text-[11px] px-1">
                                {p.is_enabled ? "enabled" : "disabled"}
                              </Badge>
                              <Badge variant={p.is_default ? "default" : "outline"} className="text-[11px] px-1">
                                {p.is_default ? "default" : "not default"}
                              </Badge>
                              <Badge variant={p.has_api_key ? "success" : "danger"} className="text-[11px] px-1">
                                {p.has_api_key ? "has key" : "no key"}
                              </Badge>
                            </div>
                          ))
                        )}
                        <p className="text-foreground-muted mt-1">
                          getActiveAiProvider(): {driverTestResult.diagnostics.active_provider_found
                            ? `${driverTestResult.diagnostics.active_provider_name} (key: ${driverTestResult.diagnostics.active_provider_has_key})`
                            : "null"}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-danger font-semibold mb-1">✗ Driver Insight Error</p>
                    <p className="text-danger">{driverTestResult.error}</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Recent AI logs */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-foreground">Recent AI Request Logs</p>
                <Link href="/settings/ai/logs">
                  <Button variant="ghost" size="sm" className="h-6 text-[11px]">View All</Button>
                </Link>
            </div>
            {recentLogs.length === 0 ? (
              <p className="text-xs text-foreground-muted">No AI requests logged yet</p>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recentLogs.slice(0, 10).map((log) => (
                  <div key={log.log_id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant={log.status === "Success" ? "success" : "danger"} className="text-[11px] px-1">
                        {log.status === "Success" ? "OK" : "ERR"}
                      </Badge>
                      <span className="text-foreground truncate">{log.feature_used || "General AI"}</span>
                      <span className="text-foreground-muted hidden sm:inline">· {log.provider_name || "Rule-Based"}</span>
                    </div>
                    <span className="text-foreground-muted flex-shrink-0 ml-2">{log.duration_ms ? `${log.duration_ms}ms` : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── ADD / EDIT PROVIDER DIALOG ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
        <DialogContent className="max-w-md p-6 bg-surface border border-border rounded-2xl shadow-xl">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg font-bold text-foreground">
              {editingProvider ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1: Name * | Display Name * */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="name" className="text-xs font-medium text-foreground">
                  Name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="my-openai"
                  required
                  className="h-9 text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="display_name" className="text-xs font-medium text-foreground">
                  Display Name <span className="text-danger">*</span>
                </Label>
                <Input
                  id="display_name"
                  value={formData.display_name}
                  onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                  ref={registerField("display_name")}
                  invalid={fieldError("display_name").invalid}
                  placeholder="My OpenAI"
                  className="h-9 text-xs rounded-xl"
                />
                {fieldError("display_name").error && <p className="text-xs text-danger">{fieldError("display_name").error}</p>}
              </div>
            </div>

            {/* Row 2: Provider Class * */}
            <div className="space-y-1">
              <Label htmlFor="provider_class" className="text-xs font-medium text-foreground">
                Provider Class <span className="text-danger">*</span>
              </Label>
              <select
                id="provider_class"
                value={formData.provider_class}
                onChange={(e) => {
                  setFormData({ ...formData, provider_class: e.target.value });
                  setFetchedModelList([]);
                }}
                className="flex h-9 w-full rounded-3xl border border-border bg-surface px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="" disabled>Select provider type...</option>
                <option value="OpenAI">OpenAI</option>
                <option value="Gemini">Google Gemini</option>
                <option value="Anthropic">Anthropic Claude</option>
                <option value="Groq">Groq</option>
                <option value="DeepSeek">DeepSeek</option>
                <option value="Custom">Custom OpenAI-Compatible</option>
              </select>
            </div>

            {/* Row 3: Base URL | Endpoint (optional) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="base_url" className="text-xs font-medium text-foreground">Base URL</Label>
                <Input
                  id="base_url"
                  value={formData.base_url}
                   onChange={(e) => {
                     setFormData({ ...formData, base_url: e.target.value });
                     setFetchedModelList([]);
                   }}
                  ref={registerField("base_url")}
                  invalid={fieldError("base_url").invalid}
                  placeholder="https://api.openai.com/v1"
                  className="h-9 text-xs rounded-xl font-mono"
                />
                {fieldError("base_url").error && <p className="text-xs text-danger">{fieldError("base_url").error}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="endpoint_path" className="text-xs font-medium text-foreground">
                  Endpoint <span className="text-foreground-muted font-normal">(optional)</span>
                </Label>
                <Input
                  id="endpoint_path"
                  value={formData.endpoint_path}
                  onChange={(e) => setFormData({ ...formData, endpoint_path: e.target.value })}
                  placeholder="/chat/completions"
                  className="h-9 text-xs rounded-xl font-mono"
                />
              </div>
            </div>

            {/* Row 4: Model + Fetch Button */}
            <div className="space-y-1">
              <Label htmlFor="model_name" className="text-xs font-medium text-foreground">Model</Label>
              <div className="flex gap-2">
                {fetchedModelList.length > 0 ? (
                  <select
                    id="model_name"
                    value={formData.model_name}
                    onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                    className="flex h-9 w-full rounded-3xl border border-border bg-surface px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {fetchedModelList.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="model_name"
                    value={formData.model_name}
                    onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                    ref={registerField("model_name")}
                    invalid={fieldError("model_name").invalid}
                    placeholder="gpt-4o-mini"
                    className="h-9 text-xs rounded-xl font-mono flex-1"
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  className="h-9 px-3 text-xs flex items-center gap-1.5"
                >
                  {fetchingModels ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  Fetch
                </Button>
              </div>
              {fieldError("model_name").error && <p className="text-xs text-danger">{fieldError("model_name").error}</p>}
              {fetchedModelList.length > 0 && (
                <p className="text-[11px] text-foreground-muted">{fetchedModelList.length} model(s) available — select from dropdown</p>
              )}
            </div>

            {/* Row 5: API Key (with Password Visibility Toggle 👁️) */}
            <div className="space-y-1">
              <Label htmlFor="api_key" className="text-xs font-medium text-foreground">API Key</Label>
              <div className="relative">
                <Input
                  id="api_key"
                  type={showApiKey ? "text" : "password"}
                  value={formData.api_key}
                  onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="h-9 text-xs rounded-xl pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Row 6: Temperature | Max Tokens | Timeout (s) */}
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="temperature" className="text-[11px] font-medium text-foreground">Temperature</Label>
                <Input
                  id="temperature"
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={formData.temperature}
                  onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                  ref={registerField("temperature")}
                  invalid={fieldError("temperature").invalid}
                  className="h-9 text-xs rounded-xl font-mono"
                />
                {fieldError("temperature").error && <p className="text-xs text-danger">{fieldError("temperature").error}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="max_tokens" className="text-[11px] font-medium text-foreground">Max Tokens</Label>
                <Input
                  id="max_tokens"
                  type="number"
                  value={formData.max_tokens}
                  onChange={(e) => setFormData({ ...formData, max_tokens: e.target.value })}
                  ref={registerField("max_tokens")}
                  invalid={fieldError("max_tokens").invalid}
                  className="h-9 text-xs rounded-xl font-mono"
                />
                {fieldError("max_tokens").error && <p className="text-xs text-danger">{fieldError("max_tokens").error}</p>}
              </div>

              <div className="space-y-1">
                <Label htmlFor="timeout_seconds" className="text-[11px] font-medium text-foreground">Timeout (s)</Label>
                <Input
                  id="timeout_seconds"
                  type="number"
                  value={formData.timeout_seconds}
                  onChange={(e) => setFormData({ ...formData, timeout_seconds: e.target.value })}
                  ref={registerField("timeout_seconds")}
                  invalid={fieldError("timeout_seconds").invalid}
                  className="h-9 text-xs rounded-xl font-mono"
                />
                {fieldError("timeout_seconds").error && <p className="text-xs text-danger">{fieldError("timeout_seconds").error}</p>}
              </div>
            </div>

            {/* Row 7: Set as default provider Checkbox */}
            <div className="pt-1">
              <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="rounded border-border w-4 h-4 accent-primary"
                />
                Set as default provider
              </label>
            </div>

            {/* Footer Actions: Cancel | Save */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button type="button" variant="ghost" onClick={closeDialog} className="h-9 text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="h-9 text-xs px-5">
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
