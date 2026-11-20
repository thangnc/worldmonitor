/**
 * Starter vendor watchlist for the exploited-vulnerabilities indicator (#119;
 * Lite spec, Early indicators › Catalogue). A stand-in until the owner's own
 * watchlist exists (spec open decision 1): widely deployed enterprise vendors
 * whose known-exploited CVEs most often need a same-week patch decision.
 *
 * Names are matched case-insensitively against CISA KEV's `vendorProject`
 * ("Palo Alto Networks", "Microsoft"); the aliases cover the spellings KEV and
 * NVD's CPE vendor ("paloaltonetworks") use for the same company.
 *
 * The data-breach indicator (#131) matches `domains` against a breach's
 * domain: the domain itself or any subdomain of it.
 */
export interface WatchedVendor {
  name: string;
  aliases: readonly string[];
  domains: readonly string[];
}

export const STARTER_VENDOR_WATCHLIST: readonly WatchedVendor[] = [
  { name: 'Microsoft', aliases: ['microsoft'], domains: ['microsoft.com', 'live.com', 'outlook.com', 'github.com', 'linkedin.com'] },
  { name: 'Apple', aliases: ['apple'], domains: ['apple.com', 'icloud.com'] },
  { name: 'Google', aliases: ['google', 'chromium'], domains: ['google.com', 'gmail.com', 'youtube.com'] },
  { name: 'Cisco', aliases: ['cisco'], domains: ['cisco.com', 'webex.com'] },
  { name: 'Fortinet', aliases: ['fortinet'], domains: ['fortinet.com'] },
  { name: 'Palo Alto Networks', aliases: ['palo alto networks', 'paloaltonetworks'], domains: ['paloaltonetworks.com'] },
  { name: 'Ivanti', aliases: ['ivanti', 'pulse secure', 'pulsesecure'], domains: ['ivanti.com', 'pulsesecure.net'] },
  { name: 'Citrix', aliases: ['citrix'], domains: ['citrix.com', 'cloud.com'] },
  { name: 'VMware', aliases: ['vmware', 'broadcom'], domains: ['vmware.com', 'broadcom.com'] },
  { name: 'Oracle', aliases: ['oracle'], domains: ['oracle.com'] },
  { name: 'Atlassian', aliases: ['atlassian'], domains: ['atlassian.com', 'atlassian.net', 'trello.com', 'bitbucket.org'] },
  { name: 'Adobe', aliases: ['adobe'], domains: ['adobe.com'] },
  { name: 'SAP', aliases: ['sap'], domains: ['sap.com'] },
  { name: 'Linux', aliases: ['linux'], domains: ['kernel.org', 'linuxfoundation.org'] },
  { name: 'Apache', aliases: ['apache'], domains: ['apache.org'] },
  { name: 'Mozilla', aliases: ['mozilla'], domains: ['mozilla.org', 'mozilla.com'] },
  { name: 'SonicWall', aliases: ['sonicwall'], domains: ['sonicwall.com'] },
  { name: 'Juniper', aliases: ['juniper', 'juniper networks'], domains: ['juniper.net'] },
  { name: 'F5', aliases: ['f5', 'f5 networks'], domains: ['f5.com'] },
  { name: 'GitLab', aliases: ['gitlab'], domains: ['gitlab.com'] },
];
