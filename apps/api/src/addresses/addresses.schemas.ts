import { z } from 'zod';
import { fullName } from '../auth/auth.schemas';

// India's 28 states and 8 union territories. GST depends on the state the
// order is delivered to, so it is chosen from this list, never typed freely.
export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  // The union territories.
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
] as const;

// A 10-digit Indian mobile number, for the courier. Spaces, hyphens and a
// leading +91, 91 or 0 are removed, so "+91 98450 12345" is stored as
// "9845012345".
const phone = z
  .string()
  .trim()
  .max(20)
  .transform((value) =>
    value.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''),
  )
  .pipe(
    z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
  );

// Six digits, never starting with 0. "560 001" is stored as "560001".
const pincode = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code'));

const line1 = z
  .string()
  .trim()
  .min(1, 'Enter the house number and street')
  .max(200);
// The second line is optional: empty means none.
const line2 = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .transform((value) => value || null);
const city = z.string().trim().min(1, 'Enter the city or town').max(100);
const state = z.enum(
  INDIAN_STATES,
  'Choose a state or union territory from the list',
);

// A new address. Unknown fields, such as a userId, are dropped: the address
// always belongs to the customer in the access token.
export const addressSchema = z.object({
  fullName,
  phone,
  line1,
  line2: line2.optional(),
  city,
  state,
  pincode,
  // True makes it the default address. The first address always is.
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof addressSchema>;

// A change to an address: only the fields that change. A default address
// stops being the default only when another one becomes it, so isDefault
// can only be set to true here.
export const addressUpdateSchema = z
  .object({
    fullName: fullName.optional(),
    phone: phone.optional(),
    line1: line1.optional(),
    line2: line2.optional(),
    city: city.optional(),
    state: state.optional(),
    pincode: pincode.optional(),
    isDefault: z.literal(true).optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    'Nothing to change',
  );
export type AddressUpdateInput = z.infer<typeof addressUpdateSchema>;
