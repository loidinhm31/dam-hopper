import type { RefObject } from "react";
import { SshForwardAuthFields } from "@/components/organisms/SshForwardAuthFields.js";
import { SshForwardEndpointFields } from "@/components/organisms/SshForwardEndpointFields.js";
import { SshForwardTargetFields } from "@/components/organisms/SshForwardTargetFields.js";
import type { KeyInventory, SshForwardError } from "@/lib/ssh-forward-host.js";
import type {
  SshForwardProfileDraft,
  SshForwardProfileErrors,
} from "@/lib/ssh-forward-form.js";

interface Props {
  draft: SshForwardProfileDraft;
  errors: SshForwardProfileErrors;
  keys: KeyInventory["keys"] | null;
  keyError: SshForwardError | null;
  firstInput: RefObject<HTMLInputElement | null>;
  onUpdate: (
    field: keyof SshForwardProfileDraft,
    value: string | boolean,
  ) => void;
}

export function SshForwardProfileFields({
  draft,
  errors,
  keys,
  keyError,
  firstInput,
  onUpdate,
}: Props) {
  return (
    <>
      <SshForwardEndpointFields
        draft={draft}
        errors={errors}
        firstInput={firstInput}
        onUpdate={onUpdate}
      />
      <SshForwardTargetFields
        draft={draft}
        errors={errors}
        onUpdate={onUpdate}
      />
      <SshForwardAuthFields
        draft={draft}
        errors={errors}
        keys={keys}
        keyError={keyError}
        onUpdate={onUpdate}
      />
    </>
  );
}
