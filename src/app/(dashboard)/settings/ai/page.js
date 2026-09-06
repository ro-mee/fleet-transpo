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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  getAiProviders,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  testAiProviderConnection,
  fetchAiModels,
  updateAiInstructions,
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
  FolderTree,
  ChevronDown,
} from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { cn } from "@/lib/utils";
import Link from "next/link";

const aiProviderSchema = {
  display_name: { required: true, maxLength: 100, label: "Display name" },
  base_url: { required: true, maxLength: 255, label: "Base URL" },
  model_name: { required: true, maxLength: 100, label: "Model name" },
  temperature: { required: true, type: "positiveNumber", max: 2, label: "Temperature" },
  max_tokens: { required: true, type: "positiveNumber", min: 1, max: 1000000, integer: true, label: "Max tokens" },
  timeout_seconds: { required: true, type: "positiveNumber", min: 1, max: 600, integer: true, label: "Timeout (seconds)" },
  api_key: { maxLength: 2000, label: "API key" },
};

// The server masks keys as `••••••••••••<last4>` — a value containing a bullet
// is the untouched stored key, never a new one.
function isMaskedApiKey(value) {
  return !value || String(value).includes("•");
}

export default function AiSettingsPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [deletingProvider, setDeletingProvider] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModelList, setFetchedModelList] = useState([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [expandedReport, setExpandedReport] = useState(null);
  const [mainExpanded, setMainExpanded] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState(null);
  const [promptDraft, setPromptDraft] = useState("");

  const openPromptEditor = (target, label, initial) => {
    setEditingPrompt({ target, label });
    setPromptDraft(initial || "");
  };
  const closePromptEditor = () => {
    setEditingPrompt(null);
    setPromptDraft("");
  };

  const savePromptMutation = useMutation({
    mutationFn: ({ target, content }) => updateAiInstructions(target, content),
    onSuccess: (res) => {
      toast.success(`Prompt saved (${res?.file || "instructions"}) — live immediately, no restart needed`);
      queryClient.invalidateQueries({ queryKey: ["ai-instructions"] });
      closePromptEditor();
    },
    onError: (err) => toast.error(err.message),
  });

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

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_enabled }) => updateAiProvider(id, { is_enabled }),
    onSuccess: (_data, vars) => {
      toast.success(vars.is_enabled ? "AI Provider enabled" : "AI Provider disabled");
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

    // In edit mode a masked/empty key means "keep the stored key": omit it
    // from the payload entirely instead of submitting bullets back.
    const keepStoredKey = editingProvider && isMaskedApiKey(formData.api_key);

    const isValid = validate(formData, {
      onSuccess: () => {
        const payload = {
          provider_name: formData.name.trim() || formData.provider_class,
          display_name: formData.display_name,
          base_url: formData.base_url,
          model_name: formData.model_name,
          temperature: Number(formData.temperature),
          max_tokens: Number(formData.max_tokens),
          timeout_ms: Number(formData.timeout_seconds) * 1000,
          is_default: formData.is_default,
          is_enabled: true,
        };
        if (!keepStoredKey) {
          payload.api_key = formData.api_key;
        }

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
    if (!formData.api_key || formData.api_key.startsWith("••••")) {
      toast.info("Re-enter the API key to fetch models from the provider");
      setFetchingModels(false);
      return;
    }
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
      toast.error(`Could not fetch models: ${err.message}`);
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
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={Brain}
        title="AI Provider & Engine Management"
        badge="Intelligence Core"
        description="Configure LLM engines (OpenAI, Gemini, Custom), system prompts, and rule-based fallback behavior."
        actions={
          <div className="flex items-center gap-2.5">
            <Link href="/settings/ai/logs">
              <Button size="sm" className={cn("rounded-2xl h-10 px-4 text-xs font-semibold cursor-pointer", heroButtonOutlineClass)}>
                <Activity className="w-3.5 h-3.5 mr-2" />
                View Request Logs
              </Button>
            </Link>
            <Button size="sm" onClick={openNewDialog} className={cn("rounded-2xl h-10 px-4 text-xs font-bold cursor-pointer", heroButtonPrimaryClass)}>
              <Plus className="w-3.5 h-3.5 mr-2" />
              Add Provider
            </Button>
          </div>
        }
      />

      {/* ── RULE-BASED ENGINE BANNER ── */}
      <Card className="border border-primary/20 bg-primary/5 shadow-xs rounded-3xl p-2">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-primary/10 text-primary border border-primary/20 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-foreground flex items-center gap-2">
                Deterministic Rule-Based Engine <Badge variant="success" className="text-[10px] font-bold rounded-full px-2.5">Always Active</Badge>
              </h3>
              <p className="text-xs text-foreground-secondary font-medium mt-0.5">
                Calculates vehicle utilization, predictive maintenance risk scores, and driver dispatch matching offline with 0 API key costs.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs font-bold rounded-full px-3 py-1 shrink-0">Zero Cost • 100% Uptime</Badge>
        </CardContent>
      </Card>

      {/* ── Configured Providers Grid ── */}
      <div className="space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-foreground-secondary flex items-center gap-2">
          <Brain className="w-4 h-4 text-primary" /> Configured LLM Providers
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {providers.map((p) => (
            <Card key={p.provider_id} className={`border border-border/80 bg-surface shadow-xs rounded-3xl transition-all hover:border-primary/50 ${p.is_default ? "ring-2 ring-primary border-primary/40" : ""}`}>
              <CardContent className="p-5 flex flex-col justify-between h-full space-y-4">
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-extrabold text-foreground text-base flex items-center gap-1.5">
                        {p.display_name}
                      </h3>
                      <p className="text-xs text-foreground-secondary font-data mt-0.5">{p.model_name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {p.is_default && (
                        <Badge variant="default" className="text-[10px] font-extrabold rounded-full px-2">Default</Badge>
                      )}
                      <Tooltip content={p.is_enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={p.is_enabled}
                          aria-label={`Toggle ${p.display_name}`}
                          disabled={toggleMutation.isPending}
                          onClick={() => toggleMutation.mutate({ id: p.provider_id, is_enabled: !p.is_enabled })}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed",
                            p.is_enabled ? "bg-success" : "bg-foreground/20"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform",
                              p.is_enabled ? "translate-x-[19px]" : "translate-x-[3px]"
                            )}
                          />
                        </button>
                      </Tooltip>
                      <Badge variant={p.is_enabled ? "success" : "secondary"} className="text-[10px] font-extrabold rounded-full px-2">
                        {p.is_enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-foreground-muted">
                    <p className="truncate flex items-center gap-1.5 font-medium">
                      <Globe className="w-3.5 h-3.5 text-primary shrink-0" /> {p.base_url || "Default Endpoint"}
                    </p>
                    <p className="flex items-center gap-1.5 font-data">
                      <Key className="w-3.5 h-3.5 text-primary shrink-0" /> {p.api_key_masked || "No API Key Set"}
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/60 flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-bold rounded-xl flex items-center gap-1 cursor-pointer"
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
                      <Button variant="ghost" size="icon" className="w-8 h-8 rounded-xl cursor-pointer" onClick={() => openEditDialog(p)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Delete Provider">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 rounded-xl text-danger hover:text-danger hover:bg-danger/10 cursor-pointer"
                        onClick={() => setDeletingProvider(p)}
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
            <Card className="border-0 shadow-xs rounded-3xl bg-surface col-span-full">
              <CardContent className="py-12 text-center text-foreground-muted">
                <Brain className="w-12 h-12 mx-auto mb-3 opacity-40 text-primary" />
                <p className="text-base font-bold text-foreground">No LLM Providers Configured</p>
                <p className="text-xs mt-1.5 max-w-md mx-auto leading-relaxed">
                  The system is currently running in <b>Deterministic Rule-Based Mode</b>. Add an AI provider (OpenAI, Gemini, Groq, DeepSeek) to enable natural-language intelligence summaries.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── System Instructions & Prompt Management ── */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
              <FileText className="w-4 h-4 text-primary" /> System Instructions &amp; Prompt Template
            </CardTitle>
            <p className="text-xs text-foreground-secondary mt-0.5">
              Loaded dynamically from <code className="text-primary font-data font-bold bg-primary/10 px-1.5 py-0.5 rounded-md">resources/ai/instructions.md</code>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs font-data font-bold rounded-full px-2.5">v1.0.0 Active</Badge>
            {instructions?.content ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPromptEditor("main", "instructions.md", instructions.content)}
                className="rounded-2xl h-9 px-4 text-xs font-semibold cursor-pointer shrink-0"
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {instructions?.content ? (
            <div className="rounded-2xl border border-border/60 bg-muted/20 overflow-hidden">
              <button
                type="button"
                onClick={() => setMainExpanded((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="text-sm font-bold text-foreground">Global instructions</span>
                  <code className="text-[11px] font-data text-foreground-secondary bg-background/60 px-1.5 py-0.5 rounded-md">
                    instructions.md
                  </code>
                </div>
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[11px] font-data font-bold rounded-full px-2.5 text-emerald-600">Loaded</Badge>
                  <ChevronDown className={cn("w-4 h-4 text-foreground-secondary transition-transform", mainExpanded && "rotate-180")} />
                </span>
              </button>
              {mainExpanded && (
                <div className="px-4 pb-4">
                  <pre className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap font-sans max-h-80 overflow-y-auto rounded-xl bg-background/50 p-3">
                    {instructions.content}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-foreground-secondary leading-relaxed">
              Loading instructions...
            </p>
          )}

          {/* Per-report analyst instructions */}
          <div className="mt-5 border-t border-border/60 pt-4">
            <p className="text-xs font-bold text-foreground uppercase tracking-wide mb-3">
              Per-Report Analyst Instructions
            </p>
            {instructions?.reports?.length ? (
              <div className="space-y-2">
                {instructions.reports.map((r) => (
                  <div key={r.report} className="rounded-2xl border border-border/60 bg-muted/20 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExpandedReport(expandedReport === r.report ? null : r.report)}
                      className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <FolderTree className="w-4 h-4 text-primary" />                        <span className="text-sm font-bold text-foreground capitalize">{r.report}</span>
                        <code className="text-[11px] font-data text-foreground-secondary bg-background/60 px-1.5 py-0.5 rounded-md">
                          reports/{r.report}.md
                        </code>
                      </div>
                      <span className="flex items-center gap-2">
                        {r.exists ? (
                          <Badge variant="outline" className="text-[11px] font-data font-bold rounded-full px-2.5 text-emerald-600">Loaded</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[11px] font-data font-bold rounded-full px-2.5 text-muted-foreground">Missing</Badge>
                        )}
                        <ChevronDown className={cn("w-4 h-4 text-foreground-secondary transition-transform", expandedReport === r.report && "rotate-180")} />
                      </span>
                    </button>
                    {expandedReport === r.report && (
                      <div className="px-4 pb-4">
                        <div className="flex items-center justify-end mb-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openPromptEditor(r.report, `reports/${r.report}.md`, r.exists ? r.content || "" : "")}
                            className="rounded-full h-8 px-3.5 text-[11px] font-semibold cursor-pointer"
                          >
                            <Pencil className="w-3 h-3 mr-1.5" /> {r.exists ? "Edit" : "Create"}
                          </Button>
                        </div>
                        {r.exists && r.content ? (
                          <pre className="text-xs text-foreground-secondary leading-relaxed whitespace-pre-wrap font-sans max-h-60 overflow-y-auto rounded-xl bg-background/50 p-3">
                            {r.content}
                          </pre>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No report instruction file found. The narrative will use the global{" "}
                            <code className="text-primary font-data bg-primary/10 px-1.5 py-0.5 rounded-md">instructions.md</code>.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No report instruction files detected in <code className="text-primary font-data bg-primary/10 px-1.5 py-0.5 rounded-md">resources/ai/reports/</code>.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── ADD / EDIT PROVIDER DIALOG ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
        <DialogContent className="max-w-xl w-[95vw] md:w-[580px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  {editingProvider ? "Edit AI Provider" : "Add AI Provider"}
                </DialogTitle>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Configure LLM integration, inference endpoints, and execution limits.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            {/* Section 1: Provider Identity & Class */}
            <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
              <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                  Provider Identification
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name" className="text-xs font-semibold text-foreground">
                      Internal Key <span className="text-danger">*</span>
                    </Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. openai-primary"
                      required
                      className="h-9 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="display_name" className="text-xs font-semibold text-foreground">
                      Display Name <span className="text-danger">*</span>
                    </Label>
                    <Input
                      id="display_name"
                      value={formData.display_name}
                      onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                      ref={registerField("display_name")}
                      invalid={fieldError("display_name").invalid}
                      placeholder="e.g. OpenAI GPT-4o"
                      className="h-9 text-xs"
                    />
                    {fieldError("display_name").error && <p className="text-xs text-danger">{fieldError("display_name").error}</p>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="provider_class" className="text-xs font-semibold text-foreground">
                    Provider Type / Architecture <span className="text-danger">*</span>
                  </Label>
                  <select
                    id="provider_class"
                    value={formData.provider_class}
                    onChange={(e) => {
                      setFormData({ ...formData, provider_class: e.target.value });
                      setFetchedModelList([]);
                    }}
                    className="flex h-9 w-full rounded-xl border border-border/80 bg-surface px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
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
              </div>
            </div>

            {/* Section 2: Connection & Models */}
            <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
              <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                  Connection &amp; Credentials
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="base_url" className="text-xs font-semibold text-foreground">Base URL</Label>
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
                      className="h-9 text-xs font-mono"
                    />
                    {fieldError("base_url").error && <p className="text-xs text-danger">{fieldError("base_url").error}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="endpoint_path" className="text-xs font-semibold text-foreground">
                      Endpoint <span className="text-foreground-muted font-normal text-[11px]">(Optional)</span>
                    </Label>
                    <Input
                      id="endpoint_path"
                      value={formData.endpoint_path}
                      onChange={(e) => setFormData({ ...formData, endpoint_path: e.target.value })}
                      placeholder="/chat/completions"
                      className="h-9 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="api_key" className="text-xs font-semibold text-foreground">API Secret Key</Label>
                  <div className="relative">
                    <Input
                      id="api_key"
                      type={showApiKey ? "text" : "password"}
                      value={formData.api_key}
                      onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                      placeholder="sk-..."
                      className="h-9 text-xs pr-9 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-foreground-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Model Selection */}
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="model_name" className="text-xs font-semibold text-foreground">Model Name</Label>
                  <div className="flex gap-2">
                    {fetchedModelList.length > 0 ? (
                      <select
                        id="model_name"
                        value={formData.model_name}
                        onChange={(e) => setFormData({ ...formData, model_name: e.target.value })}
                        className="flex h-9 w-full rounded-xl border border-border/80 bg-surface px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                        placeholder="e.g. gpt-4o-mini, gemini-2.5-flash"
                        className="h-9 text-xs font-mono flex-1"
                      />
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchModels}
                      disabled={fetchingModels}
                      className="h-9 px-3 text-xs flex items-center gap-1.5 shrink-0"
                    >
                      {fetchingModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Fetch Models
                    </Button>
                  </div>
                  {fieldError("model_name").error && <p className="text-xs text-danger">{fieldError("model_name").error}</p>}
                </div>
              </div>
            </div>

            {/* Section 3: Telemetry & Limits */}
            <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
              <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                  Hyperparameters &amp; Limits
                </span>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <Label htmlFor="temperature" className="text-[11px] font-medium text-foreground">Temperature</Label>
                    <Input
                      id="temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={formData.temperature}
                      onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                      ref={registerField("temperature")}
                      invalid={fieldError("temperature").invalid}
                      className="h-8 text-xs font-mono"
                    />
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
                      className="h-8 text-xs font-mono"
                    />
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
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50">
                  <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={formData.is_default}
                      onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                      className="rounded border-border w-4 h-4 accent-primary"
                    />
                    Set as active default AI provider
                  </label>
                </div>
              </div>
            </div>

            <div className="px-1 pt-1 flex items-center justify-end gap-2.5">
              <Button type="button" variant="outline" onClick={closeDialog} className="text-xs h-9 px-4">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="text-xs h-9 px-5 font-bold shadow-xs">
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                {editingProvider ? "Update Provider" : "Save Provider"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── PROMPT MARKDOWN EDITOR DIALOG ── */}
      <Dialog open={!!editingPrompt} onOpenChange={(open) => { if (!open) closePromptEditor(); }}>
        <DialogContent className="max-w-2xl w-[95vw] md:w-[640px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Edit {editingPrompt?.label || "prompt"}
                </DialogTitle>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Saved to the database and live immediately across deployments.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-content" className="text-xs font-semibold text-foreground">
                Markdown content
              </Label>
              <textarea
                id="prompt-content"
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                rows={16}
                spellCheck={false}
                className="w-full rounded-2xl border border-border/80 bg-background px-3.5 py-3 font-mono text-xs leading-relaxed text-foreground outline-none focus:border-primary/60 min-h-[16rem]"
              />
              <p className="text-[11px] text-foreground-muted font-data">
                {new TextEncoder().encode(promptDraft || "").length.toLocaleString()} / 51,200 bytes
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <Button type="button" variant="outline" onClick={closePromptEditor} className="text-xs h-9 px-4">
                Cancel
              </Button>
              <Button
                type="button"
                disabled={savePromptMutation.isPending || !promptDraft.trim()}
                onClick={() => {
                  if (!editingPrompt) return;
                  savePromptMutation.mutate({ target: editingPrompt.target, content: promptDraft });
                }}
                className="text-xs h-9 px-5 font-bold shadow-xs"
              >
                {savePromptMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Save Prompt
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingProvider}
        onOpenChange={(open) => {
          if (!open) setDeletingProvider(null);
        }}
        variant="danger"
        title="Delete provider?"
        message={
          deletingProvider
            ? `${deletingProvider.display_name || deletingProvider.provider_name || "This provider"} will be permanently removed. AI features fall back to the deterministic rule-based engine.`
            : ""
        }
        confirmLabel="Delete provider"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deletingProvider) return;
          deleteMutation.mutate(deletingProvider.provider_id, {
            onSettled: () => setDeletingProvider(null),
          });
        }}
      />
    </div>
  );
}
