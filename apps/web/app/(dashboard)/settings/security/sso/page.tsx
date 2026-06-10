"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Loader2,
  Plug,
  Plus,
  Power,
  Save,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  useSsoConfig,
  useUpdateSsoConfig,
  useTestSso,
  useDisableSso,
  useScimToken,
  useGenerateScimToken,
  useRoles,
} from "@/hooks/useSecurity";
import type {
  SsoProvider,
  SamlAttributeMapping,
  SsoTestResult,
} from "@/lib/types/security";
import { cn } from "@/lib/utils";

const PROVIDER_OPTIONS: Array<{ value: SsoProvider; label: string; hint: string }> = [
  { value: "okta", label: "Okta", hint: "Okta Identity Cloud" },
  { value: "azure_ad", label: "Azure AD / Entra ID", hint: "Microsoft Entra ID" },
  { value: "google", label: "Google Workspace", hint: "Cloud Identity SAML" },
  { value: "generic", label: "Generieke SAML 2.0-IdP", hint: "Custom IdP" },
];

function isValidPemCert(input: string): boolean {
  const trimmed = input.trim();
  return (
    trimmed.startsWith("-----BEGIN CERTIFICATE-----") &&
    trimmed.includes("-----END CERTIFICATE-----")
  );
}

export default function SsoPage() {
  const { toast } = useToast();
  const { data: config, isLoading } = useSsoConfig();
  const { data: scim } = useScimToken();
  const { data: roles } = useRoles();
  const updateMutation = useUpdateSsoConfig();
  const testMutation = useTestSso();
  const disableMutation = useDisableSso();
  const generateScim = useGenerateScimToken();

  const [provider, setProvider] = useState<SsoProvider>("okta");
  const [enabled, setEnabled] = useState(false);
  const [entryPoint, setEntryPoint] = useState("");
  const [issuer, setIssuer] = useState("");
  const [idpCert, setIdpCert] = useState("");
  const [autoCreate, setAutoCreate] = useState(false);
  const [defaultRoleId, setDefaultRoleId] = useState<string | null>(null);
  const [mapping, setMapping] = useState<SamlAttributeMapping>({
    email: "user.email",
    first_name: "user.firstName",
    last_name: "user.lastName",
    groups: "user.groups",
  });
  const [testResult, setTestResult] = useState<SsoTestResult | null>(null);
  const [generatedScimToken, setGeneratedScimToken] = useState<string | null>(null);

  useEffect(() => {
    // Alleen hydrateren wanneer er écht een config is. Een niet-geconfigureerde
    // tenant levert { configured: false } zonder velden → anders werd o.a.
    // idp_cert undefined en crashte `.trim()` de pagina (witte pagina).
    // We gaten op `provider` (alleen aanwezig bij een echte config).
    if (config && config.provider) {
      setProvider(config.provider);
      setEnabled(config.enabled);
      setEntryPoint(config.entry_point);
      setIssuer(config.issuer);
      setIdpCert(config.idp_cert ?? "");
      setAutoCreate(config.auto_create_users);
      setDefaultRoleId(config.default_role_id);
      setMapping(config.attribute_mapping);
    }
  }, [config]);

  const certValid = useMemo(() => isValidPemCert(idpCert ?? ""), [idpCert]);

  const handleSave = async () => {
    if (!entryPoint || !issuer || !idpCert) {
      toast({
        title: "Velden ontbreken",
        description: "Entry-point, issuer en IdP-certificaat zijn verplicht.",
        variant: "destructive",
      });
      return;
    }
    if (!certValid) {
      toast({
        title: "Ongeldig certificaat",
        description: "Plak een geldig PEM-formaat (X.509) certificaat.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateMutation.mutateAsync({
        provider,
        enabled,
        entry_point: entryPoint,
        issuer,
        idp_cert: idpCert,
        auto_create_users: autoCreate,
        default_role_id: defaultRoleId,
        attribute_mapping: mapping,
      });
      toast({
        title: "SSO opgeslagen",
        description: "De configuratie is bijgewerkt.",
      });
    } catch (err) {
      toast({
        title: "Opslaan mislukt",
        description: err instanceof Error ? err.message : "Onbekende fout.",
        variant: "destructive",
      });
    }
  };

  const handleTest = async () => {
    setTestResult(null);
    const r = await testMutation.mutateAsync();
    setTestResult(r);
    if (r.ok) {
      toast({ title: "SSO werkt", description: r.message });
    } else {
      toast({
        title: `SSO-test mislukt (${r.step ?? "?"})`,
        description: r.message,
        variant: "destructive",
      });
    }
  };

  const handleDisable = async () => {
    if (!confirm("Weet je zeker dat je SSO wilt uitschakelen? Gebruikers zullen weer met wachtwoord moeten inloggen.")) {
      return;
    }
    await disableMutation.mutateAsync();
    setEnabled(false);
    toast({ title: "SSO uitgeschakeld" });
  };

  const handleCopy = async (text: string, label = "Gekopieerd") => {
    await navigator.clipboard.writeText(text);
    toast({ title: label });
  };

  const handleGenerateScim = async () => {
    const result = await generateScim.mutateAsync();
    setGeneratedScimToken(result.full_token);
    toast({
      title: "SCIM-token gegenereerd",
      description: "Bewaar het token nu — het is hierna niet meer zichtbaar.",
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href="/settings/security"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Terug naar Security
      </Link>

      <PageHeader
        title="SSO / SAML configuratie"
        description="Schakel single-sign-on in via je identity-provider. Ondersteunt SAML 2.0 met optionele SCIM-provisioning."
        actions={
          <div className="flex items-center gap-2">
            {config?.enabled ? (
              <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0">
                <CheckCircle2 className="h-3 w-3" />
                Actief
              </Badge>
            ) : (
              <Badge className="gap-1 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-0">
                Niet actief
              </Badge>
            )}
            {config?.enabled && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisable}
                disabled={disableMutation.isPending}
              >
                <Power className="mr-1.5 h-3.5 w-3.5" />
                Uitschakelen
              </Button>
            )}
          </div>
        }
      />

      {isLoading && (
        <div className="text-sm text-muted-foreground">Laden…</div>
      )}

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">Configuratie</TabsTrigger>
          <TabsTrigger value="metadata">SP Metadata</TabsTrigger>
          <TabsTrigger value="test">Test</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning</TabsTrigger>
          <TabsTrigger value="scim">SCIM</TabsTrigger>
        </TabsList>

        {/* Configuratie */}
        <TabsContent value="config" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Identity Provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">SSO ingeschakeld</p>
                  <p className="text-xs text-muted-foreground">
                    Wanneer aan, zien gebruikers de SSO-knop op de inlogpagina.
                  </p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => setProvider(v as SsoProvider)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div>
                          <div className="font-medium">{p.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {p.hint}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Entry-point URL (SSO endpoint)</Label>
                <Input
                  placeholder="https://example.okta.com/app/.../sso/saml"
                  value={entryPoint}
                  onChange={(e) => setEntryPoint(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  De URL waar TalentFlow een SAML AuthnRequest naartoe stuurt.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Issuer (entityID)</Label>
                <Input
                  placeholder="http://www.okta.com/exk1abcDEF"
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>IdP-certificaat (X.509, PEM)</Label>
                <Textarea
                  rows={8}
                  className="font-mono text-[11px]"
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  value={idpCert}
                  onChange={(e) => setIdpCert(e.target.value)}
                />
                <p
                  className={cn(
                    "text-[11px]",
                    idpCert.length === 0
                      ? "text-muted-foreground"
                      : certValid
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                  )}
                >
                  {idpCert.length === 0
                    ? "Plak het X.509-certificaat van de IdP."
                    : certValid
                    ? "PEM-formaat OK."
                    : "Ongeldig formaat — moet beginnen met '-----BEGIN CERTIFICATE-----'."}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Attribuut-mapping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Welke SAML-claims worden gebruikt voor user-velden. Je kunt
                Okta-style (<code>user.email</code>) of fully-qualified URI&apos;s
                gebruiken.
              </p>
              {(
                [
                  { key: "email", label: "E-mail (verplicht, uniek)" },
                  { key: "first_name", label: "Voornaam" },
                  { key: "last_name", label: "Achternaam" },
                  { key: "groups", label: "Groepen (optioneel — voor role-mapping)" },
                ] as Array<{ key: keyof SamlAttributeMapping; label: string }>
              ).map((row) => (
                <div key={row.key} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-start">
                  <Label className="pt-2 sm:col-span-1">{row.label}</Label>
                  <Input
                    className="sm:col-span-2 font-mono text-xs"
                    placeholder="user.email"
                    value={mapping[row.key] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({ ...m, [row.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0"
            >
              {updateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              SSO-config opslaan
            </Button>
          </div>
        </TabsContent>

        {/* SP metadata */}
        <TabsContent value="metadata" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Service-provider gegevens</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Configureer onderstaande waarden in je IdP (Okta application,
                Azure AD enterprise app, etc.). De metadata-XML kan ook
                rechtstreeks geïmporteerd worden waar dat ondersteund is.
              </p>
              {[
                { label: "SP Entity ID (Audience)", value: config?.sp_entity_id },
                { label: "ACS URL (Reply URL)", value: config?.sp_acs_url },
                { label: "Metadata URL (XML)", value: config?.sp_metadata_url },
              ].map((row) => (
                <div key={row.label} className="space-y-1">
                  <Label className="text-xs">{row.label}</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={row.value ?? "—"}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => row.value && handleCopy(row.value)}
                      title="Kopieer"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {config?.sp_metadata_url && (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={config.sp_metadata_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="mr-2 h-3.5 w-3.5" />
                    Download metadata.xml
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Test */}
        <TabsContent value="test" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">SSO-verbinding testen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Voert een eind-tot-eind validatie uit: metadata-fetch,
                certificaat-checks, en een mock SAML-AuthnRequest. Veilig om
                meerdere keren uit te voeren.
              </p>
              <Button
                onClick={handleTest}
                disabled={testMutation.isPending}
                variant="outline"
              >
                {testMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="mr-2 h-4 w-4" />
                )}
                Test verbinding
              </Button>

              {testResult && (
                <div
                  className={cn(
                    "rounded-lg border px-4 py-3 space-y-2",
                    testResult.ok
                      ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800"
                      : "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800"
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {testResult.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    {testResult.ok ? "Verbinding geslaagd" : `Mislukt — stap: ${testResult.step ?? "onbekend"}`}
                  </div>
                  <p className="text-xs">{testResult.message}</p>
                  {testResult.detail && (
                    <pre className="text-[11px] font-mono bg-white/60 dark:bg-black/30 rounded px-2 py-1.5 overflow-x-auto">
                      {testResult.detail}
                    </pre>
                  )}
                  {testResult.duration_ms !== undefined && (
                    <p className="text-[10px] text-muted-foreground">
                      Test duurde {testResult.duration_ms} ms.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Provisioning */}
        <TabsContent value="provisioning" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">User-provisioning</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">
                    Automatisch users aanmaken bij eerste login
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Wanneer aan, wordt een onbekend e-mailadres uit een
                    succesvolle SAML-login automatisch geregistreerd.
                  </p>
                </div>
                <Switch checked={autoCreate} onCheckedChange={setAutoCreate} />
              </div>

              <div className="space-y-2">
                <Label>Standaard-rol voor nieuwe users</Label>
                <Select
                  value={defaultRoleId ?? ""}
                  onValueChange={(v) => setDefaultRoleId(v || null)}
                  disabled={!autoCreate}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kies rol…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(roles ?? []).map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 flex gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Voor enterprise-deployments raden we SCIM-provisioning aan in
                  plaats van auto-create — dat geeft tweezijdige sync (incl.
                  deactivatie bij off-boarding).
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 border-0"
                >
                  {updateMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  <Check className="mr-2 h-4 w-4" />
                  Opslaan
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SCIM */}
        <TabsContent value="scim" className="mt-6 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">
                SCIM v2.0 provisioning (RFC 7644)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900/50 border border-border px-4 py-3 space-y-2">
                <p className="text-xs">
                  SCIM laat je IdP gebruikers + groepen synchroniseren met
                  TalentFlow zonder dat ze zich moeten inloggen. Wij
                  ondersteunen RFC 7644 endpoints:
                </p>
                <ul className="text-[11px] font-mono text-muted-foreground space-y-0.5 ml-3">
                  <li>GET /Users — lijst gebruikers</li>
                  <li>POST /Users — gebruiker aanmaken</li>
                  <li>PATCH /Users/&lt;id&gt; — gebruiker bijwerken</li>
                  <li>DELETE /Users/&lt;id&gt; — deactiveren</li>
                  <li>/Groups — analoog</li>
                </ul>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">SCIM endpoint URL</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={scim?.endpoint_url ?? ""}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => scim && handleCopy(scim.endpoint_url)}
                    title="Kopieer"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <p className="text-sm font-medium">SCIM-token</p>
                  <p className="text-xs text-muted-foreground">
                    {scim?.enabled
                      ? `Actief — laatst gebruikt: ${
                          scim.last_used_at
                            ? new Date(scim.last_used_at).toLocaleString("nl-NL")
                            : "nooit"
                        }. Prefix: ${scim.token_prefix}`
                      : "Geen actief token. Genereer er één om SCIM in te schakelen."}
                  </p>
                </div>
                <Button
                  onClick={handleGenerateScim}
                  disabled={generateScim.isPending}
                  variant={scim?.enabled ? "outline" : "default"}
                  className={!scim?.enabled ? "bg-indigo-600 hover:bg-indigo-700 border-0" : ""}
                >
                  {generateScim.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {scim?.enabled ? "Roteren" : "Genereren"}
                </Button>
              </div>

              {generatedScimToken && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 space-y-2">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Bewaar dit token nu — het is hierna niet meer zichtbaar.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={generatedScimToken}
                      className="font-mono text-xs"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => handleCopy(generatedScimToken, "Token gekopieerd")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs">Voorbeeld curl-call</Label>
                <pre className="text-[11px] font-mono bg-zinc-900 text-zinc-100 dark:bg-zinc-950 rounded-lg px-3 py-2 overflow-x-auto">
{`curl -X GET '${scim?.endpoint_url ?? ""}/Users' \\
  -H 'Authorization: Bearer <SCIM_TOKEN>' \\
  -H 'Accept: application/scim+json'`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
