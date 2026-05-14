/**
 * Pipeline template types. A pipeline_template is a reusable blueprint of
 * stages that can be cloned into a job's pipeline_stages on creation.
 * Templates can be system-wide (tenant_id = null) or tenant-specific.
 */

export interface PipelineTemplateStage {
  id: string;
  template_id: string;
  name: string;
  position: number;
  color: string;
  created_at: string;
}

export interface PipelineTemplate {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
  stages?: PipelineTemplateStage[];
}
