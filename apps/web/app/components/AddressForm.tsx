import { Form } from 'react-router';
import type { AddressProblems, AddressTyped } from '../address.ts';
import { INDIAN_STATES } from '../indian-states.ts';
import { text } from '../text/en.ts';
import { SelectField, TextField } from './FormField.tsx';
import { SendButton } from './FormPage.tsx';

const words = text.address;

// The delivery address form, to add an address or to change one (part
// 14B). Each box tells the browser what it holds, so it can fill in an
// address it knows. Whether it becomes the default: a box to tick, or a
// line when there is no choice (the first address, or the default
// already).
export function AddressForm({
  typed,
  problems,
  defaultChoice,
  defaultTicked,
  submit,
  submitting,
}: {
  typed: AddressTyped | undefined;
  problems: AddressProblems;
  defaultChoice: 'choose' | 'first' | 'already';
  defaultTicked: boolean;
  submit: string;
  submitting: string;
}) {
  return (
    <Form method="post" replace className="flex flex-col gap-6">
      <input type="hidden" name="intent" value="save" />
      <TextField
        name="fullName"
        label={words.fullName}
        autoComplete="name"
        required
        maxLength={100}
        defaultValue={typed?.fullName ?? ''}
        problem={problems.fullName}
      />
      <TextField
        name="phone"
        label={words.phone}
        type="tel"
        autoComplete="tel-national"
        inputMode="tel"
        required
        maxLength={20}
        hint={words.phoneHint}
        defaultValue={typed?.phone ?? ''}
        problem={problems.phone}
      />
      <TextField
        name="line1"
        label={words.line1}
        autoComplete="address-line1"
        required
        maxLength={200}
        defaultValue={typed?.line1 ?? ''}
        problem={problems.line1}
      />
      <TextField
        name="line2"
        label={words.line2}
        autoComplete="address-line2"
        maxLength={200}
        defaultValue={typed?.line2 ?? ''}
        problem={problems.line2}
      />
      <TextField
        name="city"
        label={words.city}
        autoComplete="address-level2"
        required
        maxLength={100}
        defaultValue={typed?.city ?? ''}
        problem={problems.city}
      />
      <SelectField
        name="state"
        label={words.state}
        autoComplete="address-level1"
        required
        options={INDIAN_STATES}
        none={words.chooseState}
        defaultValue={typed?.state ?? ''}
        problem={problems.state}
      />
      <TextField
        name="pincode"
        label={words.pincode}
        autoComplete="postal-code"
        inputMode="numeric"
        required
        maxLength={7}
        defaultValue={typed?.pincode ?? ''}
        problem={problems.pincode}
      />
      {defaultChoice === 'choose' ? (
        <label className="body-6 flex cursor-pointer items-center gap-3 self-start text-ink">
          <input
            type="checkbox"
            name="isDefault"
            value="yes"
            defaultChecked={defaultTicked}
            className="size-4 accent-primary"
          />
          {words.makeDefault}
        </label>
      ) : (
        <p className="body-6 text-ink-muted">
          {defaultChoice === 'first' ? words.firstIsDefault : words.isDefault}
        </p>
      )}
      <SendButton label={submit} sendingLabel={submitting} />
    </Form>
  );
}
