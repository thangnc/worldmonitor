/**
 * Starter vendor watchlist for the exploited-vulnerabilities indicator (#119;
 * Lite spec, Early indicators › Catalogue). A stand-in until the owner's own
 * watchlist exists (spec open decision 1): widely deployed enterprise vendors
 * whose known-exploited CVEs most often need a same-week patch decision.
 *
 * Names are matched case-insensitively against CISA KEV's `vendorProject`
 * ("Palo Alto Networks", "Microsoft"); the aliases cover the spellings KEV and
 * NVD's CPE vendor ("paloaltonetworks") use for the same company.
 */
export interface WatchedVendor {
  name: string;
  aliases: readonly string[];
}

export const STARTER_VENDOR_WATCHLIST: readonly WatchedVendor[] = [
  { name: 'Microsoft', aliases: ['microsoft'] },
  { name: 'Apple', aliases: ['apple'] },
  { name: 'Google', aliases: ['google', 'chromium'] },
  { name: 'Cisco', aliases: ['cisco'] },
  { name: 'Fortinet', aliases: ['fortinet'] },
  { name: 'Palo Alto Networks', aliases: ['palo alto networks', 'paloaltonetworks'] },
  { name: 'Ivanti', aliases: ['ivanti', 'pulse secure', 'pulsesecure'] },
  { name: 'Citrix', aliases: ['citrix'] },
  { name: 'VMware', aliases: ['vmware', 'broadcom'] },
  { name: 'Oracle', aliases: ['oracle'] },
  { name: 'Atlassian', aliases: ['atlassian'] },
  { name: 'Adobe', aliases: ['adobe'] },
  { name: 'SAP', aliases: ['sap'] },
  { name: 'Linux', aliases: ['linux'] },
  { name: 'Apache', aliases: ['apache'] },
  { name: 'Mozilla', aliases: ['mozilla'] },
  { name: 'SonicWall', aliases: ['sonicwall'] },
  { name: 'Juniper', aliases: ['juniper', 'juniper networks'] },
  { name: 'F5', aliases: ['f5', 'f5 networks'] },
  { name: 'GitLab', aliases: ['gitlab'] },
];
