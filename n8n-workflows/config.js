// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Chris Arsenault / 1450 Enterprises LLC
// Production Line Central Configuration
// =====================================
// All paths are relative to the production_line root directory.
// To relocate the project, only change PRODUCTION_LINE_ROOT.

import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ============ ROOT CONFIGURATION ============
// Change this ONE value to relocate the entire project
const PRODUCTION_LINE_ROOT = process.env.PRODUCTION_LINE_ROOT || 'C:/dev/production_line';

// ============ DERIVED PATHS ============
// All paths below are relative to PRODUCTION_LINE_ROOT

const config = {
  // Root directory
  root: PRODUCTION_LINE_ROOT,
  
  // ============ DIRECTORY STRUCTURE ============
  paths: {
    // Control Center (dashboard, API, frontend)
    control: join(PRODUCTION_LINE_ROOT, 'control'),
    controlBackend: join(PRODUCTION_LINE_ROOT, 'control/backend'),
    controlFrontend: join(PRODUCTION_LINE_ROOT, 'control/frontend'),
    controlData: join(PRODUCTION_LINE_ROOT, 'control/backend/data'),
    
    // Workflows (n8n workflow JSON files)
    workflows: join(PRODUCTION_LINE_ROOT, 'workflows'),
    
    // Pre-production (blueprints, roadmaps, planning docs)
    preProduction: join(PRODUCTION_LINE_ROOT, 'pre_production'),
    
    // Assets (finished products, generated files)
    assets: join(PRODUCTION_LINE_ROOT, 'assets'),
    assetsEbooks: join(PRODUCTION_LINE_ROOT, 'assets/ebooks'),
    assetsCourses: join(PRODUCTION_LINE_ROOT, 'assets/courses'),
    assetsTemplates: join(PRODUCTION_LINE_ROOT, 'assets/templates'),
    assetsImages: join(PRODUCTION_LINE_ROOT, 'assets/images'),
    assetsMarketing: join(PRODUCTION_LINE_ROOT, 'assets/marketing'),
    
    // Notion (exports, templates, CSVs)
    notion: join(PRODUCTION_LINE_ROOT, 'Notion'),
    
    // Ecosystems (value stream documentation)
    ecosystems: join(PRODUCTION_LINE_ROOT, 'ecosystems'),
    
    // Streams (distribution site assets)
    streams: join(PRODUCTION_LINE_ROOT, 'streams'),
    
    // Research & working files
    research: join(PRODUCTION_LINE_ROOT, 'research'),
    drafts: join(PRODUCTION_LINE_ROOT, 'drafts'),
    
    // Logs and temporary files
    logs: join(PRODUCTION_LINE_ROOT, 'logs'),
    temp: join(PRODUCTION_LINE_ROOT, 'temp'),
  },
  
  // ============ DATABASE ============
  database: {
    path: join(PRODUCTION_LINE_ROOT, 'control/backend/data/control-center.db'),
    backupDir: join(PRODUCTION_LINE_ROOT, 'control/backend/data/backups'),
  },
  
  // ============ WORKFLOW DEFINITIONS ============
  workflows: {
    W5: {
      id: 'W5',
      name: 'Deep Research Engine',
      file: 'W5_Deep_Research_Engine.json',
      cost: 0.25,
      outputDir: 'research',
    },
    W6: {
      id: 'W6',
      name: 'Outline Generator',
      file: 'W6_Outline_Generator.json',
      cost: 0.05,
      outputDir: 'drafts/outlines',
    },
    W7: {
      id: 'W7',
      name: 'Teaser Package Generator',
      file: 'W7_Teaser_Package_Generator.json',
      cost: 0.12,
      outputDir: 'assets/marketing',
    },
    W9: {
      id: 'W9',
      name: 'Chapter Writer',
      file: 'W9_Chapter_Writer.json',
      cost: 0.60,
      outputDir: 'drafts/chapters',
    },
    W12: {
      id: 'W12',
      name: 'Ebook Assembler',
      file: 'W12_Ebook_Assembler.json',
      cost: 0.01,
      outputDir: 'assets/ebooks',
    },
    W13: {
      id: 'W13',
      name: 'Image Generator',
      file: 'W13_Image_Generator.json',
      cost: 0.60,
      outputDir: 'assets/images',
    },
    W18: {
      id: 'W18',
      name: 'Marketplace Uploader',
      file: 'W18_Marketplace_Uploader.json',
      cost: 0.00,
      outputDir: null, // External upload
    },
  },
  
  // ============ ASSET ORGANIZATION ============
  assetTypes: {
    ebook: {
      extensions: ['.pdf', '.epub', '.mobi', '.docx'],
      subfolders: ['covers', 'chapters', 'final'],
    },
    course: {
      extensions: ['.mp4', '.pdf', '.pptx', '.docx'],
      subfolders: ['videos', 'slides', 'workbooks', 'transcripts'],
    },
    template: {
      extensions: ['.xlsx', '.docx', '.pptx', '.pdf', '.zip'],
      subfolders: ['notion', 'google', 'microsoft', 'canva'],
    },
    image: {
      extensions: ['.png', '.jpg', '.jpeg', '.webp', '.svg'],
      subfolders: ['covers', 'social', 'ads', 'mockups'],
    },
    marketing: {
      extensions: ['.pdf', '.docx', '.txt', '.md'],
      subfolders: ['descriptions', 'emails', 'landing-pages', 'ads'],
    },
  },
  
  // ============ API CONFIGURATION ============
  api: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || 'localhost',
  },
  
  // ============ N8N CONFIGURATION ============
  n8n: {
    apiUrl: process.env.N8N_API_URL || 'http://localhost:5678',
    apiKey: process.env.N8N_API_KEY || '',
    webhookUrl: process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook',
  },
};

// ============ HELPER FUNCTIONS ============

/**
 * Get the full path for a relative path within the project
 * @param {string} relativePath - Path relative to production_line root
 * @returns {string} Full absolute path
 */
export function getPath(relativePath) {
  return join(config.root, relativePath);
}

/**
 * Get the full path for an asset
 * @param {string} assetType - Type of asset (ebook, course, template, image, marketing)
 * @param {string} subfolder - Optional subfolder within the asset type
 * @param {string} filename - Optional filename
 * @returns {string} Full path to the asset location
 */
export function getAssetPath(assetType, subfolder = '', filename = '') {
  const basePath = join(config.paths.assets, assetType + 's');
  if (subfolder && filename) {
    return join(basePath, subfolder, filename);
  } else if (subfolder) {
    return join(basePath, subfolder);
  }
  return basePath;
}

/**
 * Get the workflow file path
 * @param {string} workflowId - Workflow ID (e.g., 'W5')
 * @returns {string} Full path to the workflow JSON file
 */
export function getWorkflowPath(workflowId) {
  const workflow = config.workflows[workflowId];
  if (!workflow) return null;
  return join(config.paths.workflows, workflow.file);
}

/**
 * Get the output directory for a workflow
 * @param {string} workflowId - Workflow ID (e.g., 'W5')
 * @returns {string} Full path to the workflow's output directory
 */
export function getWorkflowOutputPath(workflowId) {
  const workflow = config.workflows[workflowId];
  if (!workflow || !workflow.outputDir) return null;
  return join(config.root, workflow.outputDir);
}

/**
 * Convert an absolute path to a relative path (from root)
 * @param {string} absolutePath - Full absolute path
 * @returns {string} Path relative to production_line root
 */
export function toRelativePath(absolutePath) {
  return absolutePath.replace(config.root, '').replace(/^[\/\\]/, '');
}

export default config;
