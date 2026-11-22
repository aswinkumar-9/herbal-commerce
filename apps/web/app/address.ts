// A delivery address as the API keeps it (ADR 0019): the phone as 10
// digits and the PIN code as 6, without spaces.
export type Address = {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
};

// The fields of the address form, in the order they are shown.
export const ADDRESS_FIELDS = [
  'fullName',
  'phone',
  'line1',
  'line2',
  'city',
  'state',
  'pincode',
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

// What was typed into the address form, kept as typed.
export type AddressTyped = Record<AddressField, string>;

export type AddressProblems = Partial<Record<AddressField | 'form', string>>;

// "9845012345" reads as "98450 12345".
export const phoneShown = (phone: string): string =>
  /^\d{10}$/.test(phone) ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

// An address as the form shows it to be changed.
export const typedFrom = (address: Address): AddressTyped => ({
  fullName: address.fullName,
  phone: phoneShown(address.phone),
  line1: address.line1,
  line2: address.line2 ?? '',
  city: address.city,
  state: address.state,
  pincode: address.pincode,
});
