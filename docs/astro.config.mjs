import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import starlightShadcn from 'starlight-shadcn';
import remarkLinks from './src/remark-links.mjs';
import remarkMermaid from './src/remark-mermaid.mjs';

const base = process.env.BASE ?? '/shepherd';
export default defineConfig({
  site: process.env.SITE ?? 'https://jagreehal.github.io',
  base,
  trailingSlash: 'always',
  markdown: { processor: unified({ remarkPlugins: [remarkMermaid, [remarkLinks, { defaultBase: '/shepherd', base }]] }) },
  integrations: [
    {
      name: 'mermaid-flow-player',
      hooks: { 'astro:config:setup': ({ injectScript }) => injectScript('page', "import '/src/scripts/flow-player.ts';") },
    },
    starlight({
      title: 'Shepherd',
      description: 'Review changes, fix findings and prepare pull requests for approval.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/shepherd' }],
      favicon: '/favicon.png',
      head: [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base.replace(/\/$/, '')}/apple-touch-icon.png` } }],
      customCss: ['./src/styles/global.css'],
      lastUpdated: true,
      plugins: [
        starlightShadcn({
          navLinks: [
            { label: 'Docs', href: '/start/quickstart/', activeMatch: '/(start|guides)/' },
            { label: 'Configure', href: '/start/customize/', activeMatch: '/configuration/' },
            { label: 'Reference', href: '/reference/commands/', activeMatch: '/reference/' },
          ],
        }),
      ],
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
        "label": "Set up the review in GitHub Actions",
        "slug": "integrations/github-actions"
      },
      {
        "label": "First run",
        "slug": "start/quickstart"
      },
      {
        "label": "Customize for your team",
        "slug": "start/customize"
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
        "label": "Read and respond to a review",
        "slug": "guides/pull-requests"
      },
      {
        "label": "Review before opening a pull request",
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
        "label": "Compose reviews for your stack",
        "slug": "configuration/stacks"
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
        "label": "Use Shepherd with pstack",
        "slug": "integrations/pstack"
      },
      {
        "label": "Send pull request state notifications",
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
        "label": "Review costs",
        "slug": "operations/costs"
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
      },
      {
        "label": "Measure review accuracy",
        "slug": "contributing/evaluation"
      }
    ]
  }
],
    }),
  ],
});
