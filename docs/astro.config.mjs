import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import mermaid from 'astro-mermaid';
import remarkLinks from './src/remark-links.mjs';

const base = process.env.BASE ?? '/shepherd';
export default defineConfig({
  site: process.env.SITE ?? 'https://jagreehal.github.io',
  base,
  trailingSlash: 'always',
  markdown: { processor: unified({ remarkPlugins: [[remarkLinks, { defaultBase: '/shepherd', base }]] }) },
  integrations: [
    mermaid({ theme: 'neutral', autoTheme: true }),
    starlight({
      title: 'Shepherd',
      description: 'Review changes, fix findings and prepare pull requests for approval.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/shepherd' }],
      editLink: { baseUrl: 'https://github.com/jagreehal/shepherd/edit/main/docs/' },
      sidebar: [
  {
    "label": "Start here",
    "items": [
      {
        "label": "Overview",
        "slug": ""
      },
      {
        "label": "First run",
        "slug": "start/quickstart"
      },
      {
        "label": "Choose a setup",
        "slug": "start/choose-a-setup"
      }
    ]
  },
  {
    "label": "Guides",
    "items": [
      {
        "label": "Review before opening a PR",
        "slug": "guides/local-review"
      },
      {
        "label": "Understand results and commit status",
        "slug": "guides/results"
      },
      {
        "label": "Investigate an incident",
        "slug": "guides/incidents"
      }
    ]
  },
  {
    "label": "Configuration",
    "items": [
      {
        "label": "Configuration reference",
        "slug": "reference/configuration"
      },
      {
        "label": "Compose team policy and recipes",
        "slug": "configuration/team-policy"
      },
      {
        "label": "Team examples",
        "slug": "configuration/examples"
      },
      {
        "label": "Build and share review lenses",
        "slug": "configuration/lenses"
      },
      {
        "label": "Choose models",
        "slug": "configuration/models"
      }
    ]
  },
  {
    "label": "Integrations",
    "items": [
      {
        "label": "Use Shepherd with Stamp",
        "slug": "integrations/stamp"
      },
      {
        "label": "Run in GitHub Actions",
        "slug": "integrations/github-actions"
      },
      {
        "label": "PR state notifications",
        "slug": "integrations/notifications"
      }
    ]
  },
  {
    "label": "Operations",
    "items": [
      {
        "label": "Troubleshooting",
        "slug": "operations/troubleshooting"
      },
      {
        "label": "Upgrades and maintenance",
        "slug": "operations/upgrades"
      },
      {
        "label": "Trace an iteration",
        "slug": "operations/traces"
      },
      {
        "label": "Improve reviews with garden",
        "slug": "operations/gardening"
      },
      {
        "label": "Garden trace scoring",
        "slug": "operations/gardener-telemetry"
      }
    ]
  },
  {
    "label": "Concepts",
    "items": [
      {
        "label": "Review, triage and CI repair",
        "slug": "concepts/review-loop"
      },
      {
        "label": "Rules for reviews and fixes",
        "slug": "concepts/fix-boundaries"
      }
    ]
  },
  {
    "label": "Reference",
    "items": [
      {
        "label": "Commands",
        "slug": "reference/commands"
      },
      {
        "label": "Environment and credentials",
        "slug": "reference/environment"
      },
      {
        "label": "Skills and human decisions",
        "slug": "reference/skills"
      },
      {
        "label": "Credits",
        "slug": "reference/credits"
      }
    ]
  },
  {
    "label": "Contributing",
    "items": [
      {
        "label": "Documentation",
        "slug": "contributing/docs"
      },
      {
        "label": "Develop Shepherd",
        "slug": "contributing/development"
      }
    ]
  }
],
    }),
  ],
});
