import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { JobForm } from "@/components/jobs/JobForm";
import { Button } from "@/components/ui/button";

export default function NewJobPage() {
  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground hover:text-foreground -ml-2">
          <Link href="/jobs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Terug
          </Link>
        </Button>
      </div>
      <PageHeader
        title="Nieuwe vacature"
        description="Maak een nieuwe vacature aan voor je team."
      />
      <JobForm showTemplatePicker />
    </div>
  );
}
