/**
 * Rule registry. New rules MUST pass self-test before being added here.
 */

import type { Rule } from '../types.js';
import noSourcePin from './no-source-pin.js';
import noLocalStorageAuth from './no-localStorage-auth.js';
import noOrCompanyIdNull from './no-or-company-id-null.js';

export const allRules: Rule[] = [
  noSourcePin,
  noLocalStorageAuth,
  noOrCompanyIdNull,
];
