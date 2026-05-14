"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCreateCandidate } from "@/hooks/useCandidates";
import { useToast } from "@/components/ui/use-toast";
import { CustomFieldsRenderer } from "@/components/common/CustomFieldsRenderer";
import type { CustomFieldValue } from "@/lib/types/atsExtensions";

const candidateSchema = z.object({
  name: z.string().min(1, "Naam is verplicht"),
  email: z.string().email("Ongeldig e-mailadres"),
  phone: z.string().optional(),
  source: z.string().min(1, "Bron is verplicht"),
  skills_raw: z.string().optional(),
});

type FormData = z.infer<typeof candidateSchema>;

interface CandidateFormProps {
  onSuccess?: () => void;
}

export function CandidateForm({ onSuccess }: CandidateFormProps) {
  const { toast } = useToast();
  const createCandidate = useCreateCandidate();
  const [customValues, setCustomValues] = useState<Record<string, CustomFieldValue>>({});

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(candidateSchema),
    defaultValues: { source: "Manual" },
  });

  const onSubmit = async (data: FormData) => {
    try {
      await createCandidate.mutateAsync({
        name: data.name,
        email: data.email,
        phone: data.phone || undefined,
        source: data.source,
        skills: data.skills_raw
          ? data.skills_raw
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        tags: [],
        // Custom fields are passed via `notes` for backwards-compat with the
        // current candidate API; once the backend supports a dedicated
        // custom_fields object this can be replaced. Empty values are
        // ignored so the field never pollutes the notes column.
        ...(Object.keys(customValues).length > 0
          ? {
              notes:
                "Custom velden:\n" +
                Object.entries(customValues)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
                  .join("\n"),
            }
          : {}),
      });
      toast({
        title: "Kandidaat toegevoegd",
        description: `${data.name} is succesvol aangemaakt.`,
      });
      onSuccess?.();
    } catch {
      toast({
        variant: "destructive",
        title: "Fout",
        description: "Kandidaat kon niet worden aangemaakt.",
      });
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nieuwe kandidaat</DialogTitle>
        <DialogDescription>
          Voeg een nieuwe kandidaat toe aan het systeem.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
        <div className="space-y-2">
          <Label htmlFor="name">Volledige naam</Label>
          <Input
            id="name"
            placeholder="Jan de Vries"
            autoComplete="name"
            {...register("name")}
            className={errors.name ? "border-destructive" : ""}
          />
          {errors.name && (
            <p className="text-xs text-destructive">
              {errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">E-mailadres</Label>
          <Input
            id="email"
            type="email"
            placeholder="jan@voorbeeld.nl"
            {...register("email")}
            className={errors.email ? "border-destructive" : ""}
          />
          {errors.email && (
            <p className="text-xs text-destructive">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefoonnummer (optioneel)</Label>
          <Input
            id="phone"
            placeholder="+31 6 12345678"
            {...register("phone")}
          />
        </div>

        <div className="space-y-2">
          <Label>Bron</Label>
          <Select
            defaultValue="Manual"
            onValueChange={(val) => setValue("source", val)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecteer bron" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LinkedIn">LinkedIn</SelectItem>
              <SelectItem value="Indeed">Indeed</SelectItem>
              <SelectItem value="Referral">Aanbeveling</SelectItem>
              <SelectItem value="Career Fair">Carrièrebeurs</SelectItem>
              <SelectItem value="Behance">Behance</SelectItem>
              <SelectItem value="Manual">Handmatig</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="skills_raw">Skills (komma gescheiden)</Label>
          <Input
            id="skills_raw"
            placeholder="React, TypeScript, Node.js"
            {...register("skills_raw")}
          />
        </div>

        <CustomFieldsRenderer
          entityType="candidate"
          values={customValues}
          onChange={(key, value) =>
            setCustomValues((cur) => ({ ...cur, [key]: value }))
          }
        />

        <DialogFooter>
          <Button
            type="submit"
            className="w-full"
            disabled={createCandidate.isPending}
          >
            {createCandidate.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Kandidaat toevoegen
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
