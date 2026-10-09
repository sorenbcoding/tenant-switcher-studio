import { checkOrchestratorUrl } from './identity';
import { Preset } from './model';

/** Values submitted by the add/edit form in the side panel. */
export interface PresetFormValues {
  id?: string;
  presetName: string;
  orchestratorUrl: string;
  clientId: string;
  /** Empty when editing means "keep the stored secret". */
  clientSecret: string;
  syncUipCli: boolean;
}

export type FormField = 'presetName' | 'orchestratorUrl' | 'clientId' | 'clientSecret';
export type FormErrors = Partial<Record<FormField, string>>;

/** Field-level validation; an empty result means the form can be saved. */
export function validatePresetForm(values: PresetFormValues, existing: Preset[], hasStoredSecret: boolean): FormErrors {
  const errors: FormErrors = {};
  const name = values.presetName.trim();
  if (!name) {
    errors.presetName = 'Enter a preset name.';
  } else {
    const clash = existing.find(
      (p) => p.id !== values.id?.toLowerCase() && p.presetName.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    );
    if (clash) {
      errors.presetName = `A preset named "${clash.presetName}" already exists. Choose another name.`;
    }
  }
  const urlError = checkOrchestratorUrl(values.orchestratorUrl);
  if (urlError) {
    errors.orchestratorUrl = urlError;
  }
  if (!values.clientId.trim()) {
    errors.clientId = 'Enter the machine client ID.';
  }
  if (!values.clientSecret && !hasStoredSecret) {
    errors.clientSecret = 'Enter the client secret.';
  }
  return errors;
}
