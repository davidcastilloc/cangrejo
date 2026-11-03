/**
 * Canonical 107 Standard Entities Catalog extracted from Maltego v4.13.0 (`com-paterva-maltego-entities-common.jar`).
 */
export interface EntityFieldSpec {
  name: string;
  type: string;
  displayName: string;
  nullable?: boolean;
  hidden?: boolean;
  readonly?: boolean;
  defaultValue?: string;
  sampleValue?: string;
}

export interface EntitySpec {
  id: string;
  category: string;
  displayName: string;
  plural: string;
  baseEntity: string | null;
  icon: string;
  allowedRoot: boolean;
  mainProperty: string | null;
  displayValueProperty?: string | null;
  regex: string | null;
  conversionOrder?: number;
  fields: EntityFieldSpec[];
}

export const STANDARD_ENTITIES_CATALOG: readonly EntitySpec[] = [
  {
    "category": "devices",
    "id": "maltego.Computer",
    "displayName": "Computer",
    "plural": "Computers",
    "baseEntity": "maltego.Device",
    "icon": "TerminalGolden",
    "allowedRoot": false,
    "mainProperty": "device",
    "regex": null,
    "fields": [
      {
        "name": "device",
        "type": "string",
        "displayName": "Device"
      }
    ]
  },
  {
    "category": "devices",
    "id": "maltego.DesktopComputer",
    "displayName": "Desktop Computer",
    "plural": "Desktop Computers",
    "baseEntity": "maltego.Computer",
    "icon": "TerminalGolden",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "devices",
    "id": "maltego.Device",
    "displayName": "Device",
    "plural": "Devices",
    "baseEntity": null,
    "icon": "RemoteControlGolden",
    "allowedRoot": true,
    "mainProperty": "device",
    "regex": null,
    "fields": [
      {
        "name": "device",
        "type": "string",
        "displayName": "Device"
      }
    ]
  },
  {
    "category": "devices",
    "id": "maltego.MobileComputer",
    "displayName": "Mobile Computer",
    "plural": "Mobile Computers",
    "baseEntity": "maltego.Computer",
    "icon": "MobileComputer",
    "allowedRoot": true,
    "mainProperty": "device",
    "regex": null,
    "fields": [
      {
        "name": "device",
        "type": "string",
        "displayName": "Device"
      }
    ]
  },
  {
    "category": "devices",
    "id": "maltego.MobilePhone",
    "displayName": "Mobile Phone",
    "plural": "Mobile Phones",
    "baseEntity": "maltego.Device",
    "icon": "MobilePhoneGolden",
    "allowedRoot": true,
    "mainProperty": "device",
    "regex": null,
    "fields": [
      {
        "name": "device",
        "type": "string",
        "displayName": "Device"
      }
    ]
  },
  {
    "category": "devices",
    "id": "maltego.Smartphone",
    "displayName": "Smartphone",
    "plural": "Smartphones",
    "baseEntity": "maltego.MobilePhone",
    "icon": "Smartphone",
    "allowedRoot": true,
    "mainProperty": "device",
    "regex": null,
    "fields": [
      {
        "name": "device",
        "type": "string",
        "displayName": "Device"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.Conversation",
    "displayName": "Conversation",
    "plural": "Conversations",
    "baseEntity": null,
    "icon": "MeetingSocial",
    "allowedRoot": false,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      },
      {
        "name": "people",
        "type": "string[]",
        "displayName": "People"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.ConversationEmail",
    "displayName": "Conversation (Email)",
    "plural": "Conversations (Email)",
    "baseEntity": "maltego.Conversation",
    "icon": "EmailConversation",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "email",
        "type": "string",
        "displayName": "Sender Email"
      },
      {
        "name": "email.recipients",
        "type": "string[]",
        "displayName": "Recipient Emails"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.ConversationPhone",
    "displayName": "Conversation (Phone)",
    "plural": "Conversations (Phone)",
    "baseEntity": "maltego.Conversation",
    "icon": "PhoneConversation",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "phonenumber.caller",
        "type": "string",
        "displayName": "Caller Number"
      },
      {
        "name": "phonenumber.callee",
        "type": "string",
        "displayName": "Callee Number"
      },
      {
        "name": "starttime",
        "type": "datetime",
        "displayName": "Start time"
      },
      {
        "name": "duration",
        "type": "timespan",
        "displayName": "Duration"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.Event",
    "displayName": "Event",
    "plural": "Events",
    "baseEntity": "maltego.Location",
    "icon": "Event",
    "allowedRoot": false,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      },
      {
        "name": "starttime",
        "type": "datetime",
        "displayName": "Start Time"
      },
      {
        "name": "stoptime",
        "type": "datetime",
        "displayName": "Stop Time"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.Incident",
    "displayName": "Incident",
    "plural": "Incidents",
    "baseEntity": "maltego.Event",
    "icon": "Murder",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.Meeting",
    "displayName": "Meeting",
    "plural": "Meetings",
    "baseEntity": "maltego.Event",
    "icon": "MeetingSocial",
    "allowedRoot": false,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      },
      {
        "name": "people",
        "type": "string[]",
        "displayName": "People"
      }
    ]
  },
  {
    "category": "events",
    "id": "maltego.MeetingBusiness",
    "displayName": "Meeting (Business)",
    "plural": "Meetings (Business)",
    "baseEntity": "maltego.Meeting",
    "icon": "MeetingBusiness",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "events",
    "id": "maltego.MeetingSocial",
    "displayName": "Meeting (Social)",
    "plural": "Meetings (Social)",
    "baseEntity": "maltego.Meeting",
    "icon": "MeetingSocial",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "groups",
    "id": "maltego.Company",
    "displayName": "Company",
    "plural": "Companies",
    "baseEntity": "maltego.Organization",
    "icon": "Company",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.EducationInstitution",
    "displayName": "Education Institution",
    "plural": "Education Institutions",
    "baseEntity": "maltego.Organization",
    "icon": "School",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.Gang",
    "displayName": "Gang",
    "plural": "Gangs",
    "baseEntity": "maltego.Organization",
    "icon": "Gang",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.OnlineGroup",
    "displayName": "Online Group",
    "plural": "Online Groups",
    "baseEntity": null,
    "icon": "OnlineGroup",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "url",
        "type": "string",
        "displayName": "URL"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.Organization",
    "displayName": "Organization",
    "plural": "Organizations",
    "baseEntity": null,
    "icon": "Organization",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.PoliticalMovement",
    "displayName": "Political Movement",
    "plural": "Political Movements",
    "baseEntity": "maltego.Organization",
    "icon": "PoliticalParty",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "groups",
    "id": "maltego.ReligiousGroup",
    "displayName": "Religious Group",
    "plural": "Religious Groups",
    "baseEntity": "maltego.Organization",
    "icon": "Church",
    "allowedRoot": true,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.AS",
    "displayName": "AS",
    "plural": "ASs",
    "baseEntity": null,
    "icon": "AS",
    "allowedRoot": true,
    "mainProperty": "as.number",
    "regex": null,
    "fields": [
      {
        "name": "as.number",
        "type": "string",
        "displayName": "AS Number"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.DNSName",
    "displayName": "DNS Name",
    "plural": "DNS Names",
    "baseEntity": null,
    "icon": "DNS Name",
    "allowedRoot": true,
    "mainProperty": "fqdn",
    "regex": "[-\\w]{1,120}\\.[-\\w]{1,120}\\.[-\\w]{0,120}\\.*[-\\w]{1,4}\\.*[a-zA-Z]+[-\\w]{1,3}",
    "fields": [
      {
        "name": "fqdn",
        "type": "string",
        "displayName": "DNS Name"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.Domain",
    "displayName": "Domain",
    "plural": "Domains",
    "baseEntity": null,
    "icon": "Domain",
    "allowedRoot": true,
    "mainProperty": "fqdn",
    "regex": "[-\\w]{1,120}\\.[-\\w]{1,4}\\.*[-\\w]{0,4}",
    "fields": [
      {
        "name": "fqdn",
        "type": "string",
        "displayName": "Domain Name"
      },
      {
        "name": "whois-info",
        "type": "string",
        "displayName": "WHOIS Info"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.IPv4Address",
    "displayName": "IPv4 Address",
    "plural": "IPv4 Addresses",
    "baseEntity": null,
    "icon": "NetCardGolden",
    "allowedRoot": true,
    "mainProperty": "ipv4-address",
    "regex": "(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)",
    "fields": [
      {
        "name": "ipv4-address",
        "type": "string",
        "displayName": "IP Address"
      },
      {
        "name": "ipaddress.internal",
        "type": "boolean",
        "displayName": "Internal"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.MXRecord",
    "displayName": "MX Record",
    "plural": "MX Records",
    "baseEntity": "maltego.DNSName",
    "icon": "MX Record",
    "allowedRoot": true,
    "mainProperty": "fqdn",
    "regex": null,
    "fields": [
      {
        "name": "fqdn",
        "type": "string",
        "displayName": "MX Record"
      },
      {
        "name": "mxrecord.priority",
        "type": "int",
        "displayName": "Priority"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.NSRecord",
    "displayName": "NS Record",
    "plural": "NS Records",
    "baseEntity": "maltego.DNSName",
    "icon": "NS Record",
    "allowedRoot": true,
    "mainProperty": "fqdn",
    "regex": null,
    "fields": [
      {
        "name": "fqdn",
        "type": "string",
        "displayName": "NS Record"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.Netblock",
    "displayName": "Netblock",
    "plural": "Netblocks",
    "baseEntity": null,
    "icon": "ClusterGolden",
    "allowedRoot": true,
    "mainProperty": "ipv4-range",
    "regex": "(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?).){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?) *- *(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?).){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)",
    "fields": [
      {
        "name": "ipv4-range",
        "type": "string",
        "displayName": "IP Range"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.URL",
    "displayName": "URL",
    "plural": "URLs",
    "baseEntity": null,
    "icon": "URL",
    "allowedRoot": true,
    "mainProperty": "url",
    "regex": "(http[s]*://([-\\w\\.\\:]*)[-\\w\\.\\:/]*/[^\\s\\?]*(\\?[^\\s]*)?)",
    "fields": [
      {
        "name": "short-title",
        "type": "string",
        "displayName": "Short title"
      },
      {
        "name": "url",
        "type": "url",
        "displayName": "URL"
      },
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.WebTitle",
    "displayName": "Website Title",
    "plural": "Website Titles",
    "baseEntity": null,
    "icon": "Alarm",
    "allowedRoot": false,
    "mainProperty": "title",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      }
    ]
  },
  {
    "category": "infrastructure",
    "id": "maltego.Website",
    "displayName": "Website",
    "plural": "Websites",
    "baseEntity": "maltego.DNSName",
    "icon": "Website",
    "allowedRoot": true,
    "mainProperty": "fqdn",
    "regex": "(http://|https://)[-\\w\\.\\:]*/*",
    "fields": [
      {
        "name": "fqdn",
        "type": "string",
        "displayName": "Website"
      },
      {
        "name": "website.ssl-enabled",
        "type": "boolean",
        "displayName": "SSL Enabled"
      },
      {
        "name": "ports",
        "type": "int[]",
        "displayName": "Ports"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Airport",
    "displayName": "Airport",
    "plural": "Airports",
    "baseEntity": "maltego.TransportHub",
    "icon": "Airport",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Church",
    "displayName": "Church",
    "plural": "Churches",
    "baseEntity": "maltego.Location",
    "icon": "Church",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.CircularArea",
    "displayName": "Circular Area",
    "plural": "Circular Areas",
    "baseEntity": null,
    "icon": "Circular Area",
    "allowedRoot": true,
    "mainProperty": "area.circular",
    "regex": "^\\s*([\\-\\d.]+)\\s*,\\s*([\\-\\d.]+)\\s*,\\s*([\\d]+)m?\\s*$",
    "fields": [
      {
        "name": "area.circular",
        "type": "string",
        "displayName": "Circular Area"
      },
      {
        "name": "latitude",
        "type": "float",
        "displayName": "Latitude"
      },
      {
        "name": "longitude",
        "type": "float",
        "displayName": "Longitude"
      },
      {
        "name": "radius",
        "type": "int",
        "displayName": "Radius (m)"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.City",
    "displayName": "City",
    "plural": "Cities",
    "baseEntity": "maltego.Location",
    "icon": "Geography",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "locations",
    "id": "maltego.Country",
    "displayName": "Country",
    "plural": "Countries",
    "baseEntity": "maltego.Location",
    "icon": "Geography",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "locations",
    "id": "maltego.CrimeScene",
    "displayName": "Crime Scene",
    "plural": "Crime Scenes",
    "baseEntity": "maltego.Location",
    "icon": "CrimeScene",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "locations",
    "id": "maltego.Harbor",
    "displayName": "Harbor",
    "plural": "Harbors",
    "baseEntity": "maltego.TransportHub",
    "icon": "Ship",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Home",
    "displayName": "Home",
    "plural": "Homes",
    "baseEntity": "maltego.Location",
    "icon": "Home",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "locations",
    "id": "maltego.Location",
    "displayName": "Location",
    "plural": "Locations",
    "baseEntity": null,
    "icon": "Location",
    "allowedRoot": true,
    "mainProperty": "location.name",
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "country",
        "type": "string",
        "displayName": "Country"
      },
      {
        "name": "city",
        "type": "string",
        "displayName": "City"
      },
      {
        "name": "streetaddress",
        "type": "string",
        "displayName": "Street Address"
      },
      {
        "name": "location.area",
        "type": "string",
        "displayName": "Area"
      },
      {
        "name": "location.areacode",
        "type": "string",
        "displayName": "Area Code"
      },
      {
        "name": "countrycode",
        "type": "string",
        "displayName": "Country Code"
      },
      {
        "name": "longitude",
        "type": "float",
        "displayName": "Longitude"
      },
      {
        "name": "latitude",
        "type": "float",
        "displayName": "Latitude"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Office",
    "displayName": "Office",
    "plural": "Offices",
    "baseEntity": "maltego.Location",
    "icon": "Office",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "locations",
    "id": "maltego.Prison",
    "displayName": "Prison",
    "plural": "Prisons",
    "baseEntity": "maltego.Location",
    "icon": "Prison",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Region",
    "displayName": "Region",
    "plural": "Regions",
    "baseEntity": "maltego.Location",
    "icon": "Geography",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.Shop",
    "displayName": "Shop",
    "plural": "Shops",
    "baseEntity": "maltego.Location",
    "icon": "Restaurant",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.TrainStation",
    "displayName": "Train Station",
    "plural": "Train Stations",
    "baseEntity": "maltego.TransportHub",
    "icon": "TrainStation",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "locations",
    "id": "maltego.TransportHub",
    "displayName": "Transport Hub",
    "plural": "Transport Hubs",
    "baseEntity": "maltego.Location",
    "icon": "TrainStation",
    "allowedRoot": false,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "location.name",
        "type": "string",
        "displayName": "Name"
      }
    ]
  },
  {
    "category": "common",
    "id": "maltego.Unknown",
    "displayName": "Unknown",
    "plural": "Unknowns",
    "baseEntity": null,
    "icon": "Unknown",
    "allowedRoot": false,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.BadGuy",
    "displayName": "Bad Guy",
    "plural": "Bad Guys",
    "baseEntity": "maltego.Person",
    "icon": "Person",
    "allowedRoot": false,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.BusinessLeader",
    "displayName": "Business Leader",
    "plural": "Business Leaders",
    "baseEntity": "maltego.Businessman",
    "icon": "CEO",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Businessman",
    "displayName": "Businessman / Employee",
    "plural": "Businessmen / Employees",
    "baseEntity": "maltego.Person",
    "icon": "Businessman",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Child",
    "displayName": "Child",
    "plural": "Children",
    "baseEntity": "maltego.Person",
    "icon": "Child",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.DrugDealer",
    "displayName": "Drug Dealer",
    "plural": "Drug Dealers",
    "baseEntity": "maltego.BadGuy",
    "icon": "DrugDealer",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Female",
    "displayName": "Female",
    "plural": "Females",
    "baseEntity": "maltego.Person",
    "icon": "AdultFemale",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "person.firstnames",
        "type": "string",
        "displayName": "First Names"
      }
    ]
  },
  {
    "category": "people",
    "id": "maltego.GangLeader",
    "displayName": "Gang Leader",
    "plural": "Gang Leaders",
    "baseEntity": "maltego.GangMember",
    "icon": "GangBoss",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.GangMember",
    "displayName": "Gang Member",
    "plural": "Gang Members",
    "baseEntity": "maltego.BadGuy",
    "icon": "GangMember",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.GoodGuy",
    "displayName": "Good Guy",
    "plural": "Good Guys",
    "baseEntity": "maltego.Person",
    "icon": "Person",
    "allowedRoot": false,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.GovernmentOfficial",
    "displayName": "Government Official",
    "plural": "Government Officials",
    "baseEntity": "maltego.Person",
    "icon": "GovermentOfficial",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Judge",
    "displayName": "Judge",
    "plural": "Judges",
    "baseEntity": "maltego.GoodGuy",
    "icon": "Judge",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.LawOfficer",
    "displayName": "Law Enforcement Officer",
    "plural": "Law Enforcement Officers",
    "baseEntity": "maltego.GoodGuy",
    "icon": "LawEnforcementOfficer",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Lawyer",
    "displayName": "Lawyer / Advocate",
    "plural": "Lawyers / Advocates",
    "baseEntity": "maltego.Person",
    "icon": "Lawyer",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Male",
    "displayName": "Male",
    "plural": "Males",
    "baseEntity": "maltego.Person",
    "icon": "AdultMale",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.MilitaryOfficer",
    "displayName": "Military Officer",
    "plural": "Military Officers",
    "baseEntity": "maltego.GoodGuy",
    "icon": "MilitaryOfficer",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.SexOffender",
    "displayName": "Sex Offender",
    "plural": "Sex Offenders",
    "baseEntity": "maltego.BadGuy",
    "icon": "SexOffender",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Terrorist",
    "displayName": "Terrorist",
    "plural": "Terrorists",
    "baseEntity": "maltego.BadGuy",
    "icon": "TerroristMember",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.TerroristLeader",
    "displayName": "Terrorist Leader",
    "plural": "Terrorist Leaders",
    "baseEntity": "maltego.Terrorist",
    "icon": "TerroristLeader",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "people",
    "id": "maltego.Unsub",
    "displayName": "Unknown Suspect",
    "plural": "Unknown Suspects",
    "baseEntity": "maltego.BadGuy",
    "icon": "UnknownSuspect",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "personal",
    "id": "maltego.Alias",
    "displayName": "Alias",
    "plural": "Aliases",
    "baseEntity": null,
    "icon": "Alias",
    "allowedRoot": true,
    "mainProperty": "alias",
    "regex": null,
    "fields": [
      {
        "name": "alias",
        "type": "string",
        "displayName": "Alias"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.Document",
    "displayName": "Document",
    "plural": "Documents",
    "baseEntity": null,
    "icon": "Document",
    "allowedRoot": true,
    "mainProperty": "url",
    "regex": null,
    "fields": [
      {
        "name": "title",
        "type": "string",
        "displayName": "Title"
      },
      {
        "name": "document.meta-data",
        "type": "string",
        "displayName": "Meta-Data"
      },
      {
        "name": "url",
        "type": "url",
        "displayName": "URL"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.EmailAddress",
    "displayName": "Email Address",
    "plural": "Email Addresses",
    "baseEntity": null,
    "icon": "Email Address",
    "allowedRoot": true,
    "mainProperty": "email",
    "regex": "(([ \\t]*([a-zA-Z0-9\\!\\#\\$\\%\\&\\'\\*\\+\\-\\/\\=\\?\\^\\_\\`\\{\\|\\}\\~]+(\\.[a-zA-Z0-9\\!\\#\\$\\%\\&\\'\\*\\+\\-\\/\\=\\?\\^\\_\\`\\{\\|\\}\\~]+)*)[ \\t]*)|(\\\"([ \\t]*([\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\x21\\x23-\\x5B\\x5D-\\x7E]|(\\\\[\\x01-\\x09\\x0B\\x0C\\x0E-\\x7F])))*[ \\t]*\\\"))@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\\.[a-zA-Z]{2,6}",
    "fields": [
      {
        "name": "email",
        "type": "string",
        "displayName": "Email Address"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.File",
    "displayName": "File",
    "plural": "Files",
    "baseEntity": null,
    "icon": "File",
    "allowedRoot": false,
    "mainProperty": "description",
    "regex": null,
    "fields": [
      {
        "name": "source",
        "type": "url",
        "displayName": "Source"
      },
      {
        "name": "description",
        "type": "string",
        "displayName": "Description"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.GPS",
    "displayName": "GPS Coordinate",
    "plural": "GPS Coordinates",
    "baseEntity": null,
    "icon": "GPS",
    "allowedRoot": true,
    "mainProperty": "gps.coordinate",
    "regex": "^\\s*([\\-\\d.]+)\\s*,\\s*([\\-\\d.]+)\\s*$",
    "fields": [
      {
        "name": "gps.coordinate",
        "type": "string",
        "displayName": "GPS Coordinate"
      },
      {
        "name": "latitude",
        "type": "float",
        "displayName": "Latitude"
      },
      {
        "name": "longitude",
        "type": "float",
        "displayName": "Longitude"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.Image",
    "displayName": "Image",
    "plural": "Images",
    "baseEntity": null,
    "icon": "Image",
    "allowedRoot": true,
    "mainProperty": "description",
    "regex": "(http[s]*://[-\\w\\.\\:]*[^\\s]*/([^\\s]+\\.(bmp|jpg|jpeg|png|gif|svg|webp))(\\?[^\\s]*)?)",
    "fields": [
      {
        "name": "description",
        "type": "string",
        "displayName": "Description"
      },
      {
        "name": "url",
        "type": "url",
        "displayName": "URL"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.Person",
    "displayName": "Person",
    "plural": "People",
    "baseEntity": null,
    "icon": "Person",
    "allowedRoot": true,
    "mainProperty": "person.fullname",
    "regex": "(\\p{Lu}{1,15}\\p{Ll}{0,15}) (\\p{Lu}{0,15}\\p{Ll}{0,15} *\\p{Lu}{0,15}\\p{Ll}{0,15} *\\p{Lu}{0,15}\\p{Ll}{0,15})",
    "fields": [
      {
        "name": "person.fullname",
        "type": "string",
        "displayName": "Full Name"
      },
      {
        "name": "person.firstnames",
        "type": "string",
        "displayName": "First Names"
      },
      {
        "name": "person.lastname",
        "type": "string",
        "displayName": "Surname"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.PhoneNumber",
    "displayName": "Phone Number",
    "plural": "Phone Numbers",
    "baseEntity": null,
    "icon": "Phone",
    "allowedRoot": true,
    "mainProperty": "phonenumber",
    "regex": null,
    "fields": [
      {
        "name": "phonenumber",
        "type": "string",
        "displayName": "Phone Number"
      },
      {
        "name": "phonenumber.countrycode",
        "type": "string",
        "displayName": "Country Code"
      },
      {
        "name": "phonenumber.citycode",
        "type": "string",
        "displayName": "City Code"
      },
      {
        "name": "phonenumber.areacode",
        "type": "string",
        "displayName": "Area Code"
      },
      {
        "name": "phonenumber.lastnumbers",
        "type": "string",
        "displayName": "Last Digits"
      },
      {
        "name": "phonenumber",
        "type": "phonenumber",
        "displayName": "Phone Number"
      },
      {
        "name": "phonenumber.original",
        "type": "string",
        "displayName": "Original"
      },
      {
        "name": "phonenumber.countrycode",
        "type": "string",
        "displayName": "Region"
      },
      {
        "name": "phonenumber.region",
        "type": "string",
        "displayName": "Region"
      },
      {
        "name": "region",
        "type": "string",
        "displayName": "Region"
      },
      {
        "name": "phonenumber.type",
        "type": "string",
        "displayName": "Type"
      },
      {
        "name": "phonenumber.national",
        "type": "string",
        "displayName": "National Number"
      },
      {
        "name": "phonenumber.extension",
        "type": "string",
        "displayName": "Extension"
      }
    ]
  },
  {
    "category": "personal",
    "id": "maltego.PhoneNumberMobile",
    "displayName": "Phone Number (Mobile)",
    "plural": "Phone Numbers (Mobile)",
    "baseEntity": "maltego.PhoneNumber",
    "icon": "MobilePhoneGolden",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "personal",
    "id": "maltego.PhoneNumberOffice",
    "displayName": "Phone Number (Office)",
    "plural": "Phone Numbers (Office)",
    "baseEntity": "maltego.PhoneNumber",
    "icon": "LandlinePhoneOffice",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "personal",
    "id": "maltego.PhoneNumberResidential",
    "displayName": "Phone Number (Residential)",
    "plural": "Phone Numbers (Residential)",
    "baseEntity": "maltego.PhoneNumber",
    "icon": "LandlinePhoneResidential",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "personal",
    "id": "maltego.Phrase",
    "displayName": "Phrase",
    "plural": "Phrases",
    "baseEntity": null,
    "icon": "Phrase",
    "allowedRoot": true,
    "mainProperty": "text",
    "regex": ".*",
    "fields": [
      {
        "name": "text",
        "type": "string",
        "displayName": "Text"
      }
    ]
  },
  {
    "category": "socialnetwork",
    "id": "maltego.Affiliation",
    "displayName": "Affiliation",
    "plural": "Affiliations",
    "baseEntity": null,
    "icon": "Facebook",
    "allowedRoot": false,
    "mainProperty": "person.name",
    "regex": null,
    "fields": [
      {
        "name": "person.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "affiliation.network",
        "type": "string",
        "displayName": "Network"
      },
      {
        "name": "affiliation.uid",
        "type": "string",
        "displayName": "UID"
      },
      {
        "name": "affiliation.profile-url",
        "type": "string",
        "displayName": "Profile URL"
      }
    ]
  },
  {
    "category": "socialnetwork",
    "id": "maltego.affiliation.Facebook",
    "displayName": "Affiliation - Facebook",
    "plural": "Affiliations - Facebook",
    "baseEntity": "maltego.Affiliation",
    "icon": "Facebook",
    "allowedRoot": false,
    "mainProperty": "person.name",
    "regex": null,
    "fields": [
      {
        "name": "person.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "affiliation.network",
        "type": "string",
        "displayName": "Network"
      },
      {
        "name": "affiliation.uid",
        "type": "string",
        "displayName": "UID"
      },
      {
        "name": "affiliation.profile-url",
        "type": "string",
        "displayName": "Profile URL"
      }
    ]
  },
  {
    "category": "socialnetwork",
    "id": "maltego.affiliation.LinkedIn",
    "displayName": "Affiliation - LinkedIn",
    "plural": "Affiliations - LinkedIn",
    "baseEntity": "maltego.Affiliation",
    "icon": "LinkedIn",
    "allowedRoot": false,
    "mainProperty": "person.name",
    "regex": null,
    "fields": [
      {
        "name": "person.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "affiliation.network",
        "type": "string",
        "displayName": "Network"
      }
    ]
  },
  {
    "category": "socialnetwork",
    "id": "maltego.affiliation.Twitter",
    "displayName": "Affiliation - Twitter",
    "plural": "Affiliations - Twitter",
    "baseEntity": "maltego.Affiliation",
    "icon": "Twitter",
    "allowedRoot": false,
    "mainProperty": "person.name",
    "regex": null,
    "fields": [
      {
        "name": "person.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "affiliation.network",
        "type": "string",
        "displayName": "Network"
      },
      {
        "name": "affiliation.uid",
        "type": "string",
        "displayName": "UID"
      },
      {
        "name": "affiliation.profile-url",
        "type": "string",
        "displayName": "Profile URL"
      },
      {
        "name": "twitter.id",
        "type": "string",
        "displayName": "Twitter ID"
      },
      {
        "name": "twitter.screen-name",
        "type": "string",
        "displayName": "Screen Name"
      },
      {
        "name": "twitter.friendcount",
        "type": "int",
        "displayName": "Friend Count"
      },
      {
        "name": "person.fullname",
        "type": "string",
        "displayName": "Real Name"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.BankAccount",
    "displayName": "Bank Account",
    "plural": "Bank Accounts",
    "baseEntity": null,
    "icon": "BankAccount",
    "allowedRoot": true,
    "mainProperty": "bank.accnumber",
    "regex": null,
    "fields": [
      {
        "name": "bank.accnumber",
        "type": "string",
        "displayName": "Account Number"
      },
      {
        "name": "bank.name",
        "type": "string",
        "displayName": "Bank"
      },
      {
        "name": "bank.branch",
        "type": "string",
        "displayName": "Branch Code"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.FlightNumber",
    "displayName": "Flight Number",
    "plural": "Flight Numbers",
    "baseEntity": null,
    "icon": "FlightNumber",
    "allowedRoot": true,
    "mainProperty": "flight.id",
    "regex": null,
    "fields": [
      {
        "name": "flight.id",
        "type": "string",
        "displayName": "Flight ID"
      },
      {
        "name": "flight.number",
        "type": "string",
        "displayName": "Flight Number"
      },
      {
        "name": "flight.airline",
        "type": "string",
        "displayName": "Airline"
      },
      {
        "name": "flight.date",
        "type": "date",
        "displayName": "Date"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.IdentificationNumber",
    "displayName": "Identification Number",
    "plural": "Identification Numbers",
    "baseEntity": null,
    "icon": "SSN",
    "allowedRoot": true,
    "mainProperty": "identification.number",
    "regex": null,
    "fields": [
      {
        "name": "identification.number",
        "type": "string",
        "displayName": "Number"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.MacAddress",
    "displayName": "MAC Address",
    "plural": "MAC Addresses",
    "baseEntity": null,
    "icon": "MacAddress",
    "allowedRoot": true,
    "mainProperty": "macaddress",
    "regex": null,
    "fields": [
      {
        "name": "macaddress",
        "type": "string",
        "displayName": "MAC Address"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.PassportNumber",
    "displayName": "Passport Number",
    "plural": "Passport Numbers",
    "baseEntity": "maltego.IdentificationNumber",
    "icon": "Passport",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": []
  },
  {
    "category": "tracking",
    "id": "maltego.VehicleRegistration",
    "displayName": "Vehicle Registration",
    "plural": "Vehicle Registrations",
    "baseEntity": null,
    "icon": "RegistrationPlate",
    "allowedRoot": true,
    "mainProperty": "vehicle.registration",
    "regex": null,
    "fields": [
      {
        "name": "vehicle.registration",
        "type": "string",
        "displayName": "Registration Number"
      }
    ]
  },
  {
    "category": "tracking",
    "id": "maltego.VinNumber",
    "displayName": "VIN Number",
    "plural": "VIN Numbers",
    "baseEntity": null,
    "icon": "VinNumber",
    "allowedRoot": true,
    "mainProperty": "vinnumber",
    "regex": null,
    "fields": [
      {
        "name": "vinnumber",
        "type": "string",
        "displayName": "VIN Number"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Bike",
    "displayName": "Motorbike / Bicycle",
    "plural": "Motorbikes / Bicycles",
    "baseEntity": "maltego.Transport",
    "icon": "Motorbike",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Boat",
    "displayName": "Boat / Ship",
    "plural": "Boats / Ships",
    "baseEntity": "maltego.Transport",
    "icon": "Ship",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Bus",
    "displayName": "Bus",
    "plural": "Busses",
    "baseEntity": "maltego.Transport",
    "icon": "Bus",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Car",
    "displayName": "Car",
    "plural": "Cars",
    "baseEntity": "maltego.Transport",
    "icon": "Car",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Plane",
    "displayName": "Plane",
    "plural": "Planes",
    "baseEntity": "maltego.Transport",
    "icon": "Plane",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Train",
    "displayName": "Train",
    "plural": "Trains",
    "baseEntity": "maltego.Transport",
    "icon": "Train",
    "allowedRoot": true,
    "mainProperty": null,
    "regex": null,
    "fields": [
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      }
    ]
  },
  {
    "category": "transportation",
    "id": "maltego.Transport",
    "displayName": "Transport",
    "plural": "Transports",
    "baseEntity": null,
    "icon": "Car",
    "allowedRoot": false,
    "mainProperty": "transport.name",
    "regex": null,
    "fields": [
      {
        "name": "transport.name",
        "type": "string",
        "displayName": "Name"
      },
      {
        "name": "transport.make",
        "type": "string",
        "displayName": "Make"
      },
      {
        "name": "transport.model",
        "type": "string",
        "displayName": "Model"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Ammunition",
    "displayName": "Ammunition",
    "plural": "Ammunition",
    "baseEntity": "maltego.Weapon",
    "icon": "Ammunition",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.BioWeapon",
    "displayName": "Bio Weapon",
    "plural": "Bio Weapons",
    "baseEntity": "maltego.WMD",
    "icon": "BioAgent",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Blade",
    "displayName": "Blade",
    "plural": "Blades",
    "baseEntity": "maltego.Weapon",
    "icon": "Knife",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.ChemicalWeapon",
    "displayName": "Chemical Weapon",
    "plural": "Chemical Weapons",
    "baseEntity": "maltego.WMD",
    "icon": "DestroyGolden",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Explosive",
    "displayName": "Explosive",
    "plural": "Explosives",
    "baseEntity": "maltego.Weapon",
    "icon": "BombGolden",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Gun",
    "displayName": "Gun",
    "plural": "Guns",
    "baseEntity": "maltego.Weapon",
    "icon": "Gun",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.IED",
    "displayName": "Improvised Explosive Device",
    "plural": "Improvised Explosive Devices",
    "baseEntity": "maltego.Weapon",
    "icon": "IED",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Missile",
    "displayName": "Missile / RPG",
    "plural": "Missiles / RPGs",
    "baseEntity": "maltego.Weapon",
    "icon": "MissileRPG",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.NuclearWeapon",
    "displayName": "Nuclear Weapon",
    "plural": "Nuclear Weapons",
    "baseEntity": "maltego.WMD",
    "icon": "Atom",
    "allowedRoot": true,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.WMD",
    "displayName": "Weapon of Mass Destruction",
    "plural": "Weapons of Mass Destruction",
    "baseEntity": "maltego.Weapon",
    "icon": "Destroy",
    "allowedRoot": false,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  },
  {
    "category": "weapons",
    "id": "maltego.Weapon",
    "displayName": "Weapon",
    "plural": "Weapons",
    "baseEntity": null,
    "icon": "Gun",
    "allowedRoot": false,
    "mainProperty": "weapon.type",
    "regex": null,
    "fields": [
      {
        "name": "weapon.type",
        "type": "string",
        "displayName": "Type"
      }
    ]
  }
];
