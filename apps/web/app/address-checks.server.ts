// What the address forms check before asking the API (part 14B), by the
// API's own rules (apps/api/src/addresses/addresses.schemas.ts), said in
// the shop's words beside the field. The API checks everything again.
import { ADDRESS_FIELDS } from './address.ts';
import type { AddressProblems, AddressTyped } from './address.ts';
import { given } from './form-checks.server.ts';
import { isIndianState } from './indian-states.ts';
import { text } from './text/en.ts';

const words = text.address.problems;

export function readAddress(form: FormData): AddressTyped {
  const typed = {} as AddressTyped;
  for (const field of ADDRESS_FIELDS) {
    typed[field] = given(form, field).trim();
  }
  return typed;
}

// As the API keeps them: "+91 98450-12345" is 9845012345, "560 001" is
// 560001.
export const phoneDigits = (phone: string): string =>
  phone.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
export const pincodeDigits = (pincode: string): string =>
  pincode.replace(/\s/g, '');

export function addressProblems(typed: AddressTyped): AddressProblems {
  const problems: AddressProblems = {};
  if (!typed.fullName) {
    problems.fullName = words.fullNameMissing;
  } else if (typed.fullName.length > 100) {
    problems.fullName = text.forms.nameLong;
  }
  if (
    typed.phone.length > 20 ||
    !/^[6-9]\d{9}$/.test(phoneDigits(typed.phone))
  ) {
    problems.phone = words.phoneWrong;
  }
  if (!typed.line1) {
    problems.line1 = words.line1Missing;
  } else if (typed.line1.length > 200) {
    problems.line1 = words.tooLong(200);
  }
  if (typed.line2.length > 200) {
    problems.line2 = words.tooLong(200);
  }
  if (!typed.city) {
    problems.city = words.cityMissing;
  } else if (typed.city.length > 100) {
    problems.city = words.tooLong(100);
  }
  if (!isIndianState(typed.state)) {
    problems.state = words.stateMissing;
  }
  if (!/^[1-9]\d{5}$/.test(pincodeDigits(typed.pincode))) {
    problems.pincode = words.pincodeWrong;
  }
  return problems;
}

// The address as the API takes it.
export const forApi = (typed: AddressTyped) => ({
  fullName: typed.fullName,
  phone: phoneDigits(typed.phone),
  line1: typed.line1,
  line2: typed.line2 || null,
  city: typed.city,
  state: typed.state,
  pincode: pincodeDigits(typed.pincode),
});

// The API's rules may grow: what it refused goes beside the field.
export function refusedByApi(fields: Record<string, string>): AddressProblems {
  const refused: AddressProblems = {};
  const said: Record<keyof AddressTyped, string> = {
    fullName: words.fullNameMissing,
    phone: words.phoneWrong,
    line1: words.line1Missing,
    line2: words.tooLong(200),
    city: words.cityMissing,
    state: words.stateMissing,
    pincode: words.pincodeWrong,
  };
  for (const field of ADDRESS_FIELDS) {
    if (fields[field]) {
      refused[field] = said[field];
    }
  }
  return refused;
}
