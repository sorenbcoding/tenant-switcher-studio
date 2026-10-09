import { describe, expect, it } from 'vitest';
import { PresetFormValues, validatePresetForm } from '../src/presetForm';

const existing = [
  { id: 'a', presetName: 'Production', orchestratorUrl: 'https://cloud.uipath.com/acme/prod/orchestrator_', clientId: '1' },
];
const valid: PresetFormValues = {
  presetName: 'Development',
  orchestratorUrl: 'https://cloud.uipath.com/acme/dev/orchestrator_',
  clientId: 'client',
  clientSecret: 'secret',
  syncUipCli: false,
};

describe('validatePresetForm', () => {
  it('accepts a complete new preset', () => {
    expect(validatePresetForm(valid, existing, false)).toEqual({});
  });

  it('reports every missing field at once', () => {
    const errors = validatePresetForm({ ...valid, presetName: ' ', orchestratorUrl: '', clientId: '', clientSecret: '' }, existing, false);
    expect(Object.keys(errors).sort()).toEqual(['clientId', 'clientSecret', 'orchestratorUrl', 'presetName']);
  });

  it('rejects a name used by another preset, case-insensitively', () => {
    expect(validatePresetForm({ ...valid, presetName: 'PRODUCTION' }, existing, false).presetName).toContain('already exists');
  });

  it('allows keeping the name and a blank secret when editing', () => {
    const edit = { ...valid, id: 'A', presetName: 'Production', clientSecret: '' };
    expect(validatePresetForm(edit, existing, true)).toEqual({});
  });
});
