/**
 * Seed a mock test from a JSON file into Supabase.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json scripts/seed-test.ts data/mock1.json
 *
 * The JSON file format is defined in data/sample-test.json
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import * as dotenv from 'dotenv'

// Load .env.local
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
// Use service role key to bypass RLS for seed operations
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

interface SeedQuestion {
  type: 'SCQ' | 'MCQ'
  text: string
  options: string[]
  correct_options: number[]
}

interface SeedSection {
  name: string
  display_order: number
  questions: SeedQuestion[]
}

interface SeedFile {
  test: {
    name: string
    duration_mins: number
  }
  sections: SeedSection[]
}

async function seedTest(filePath: string) {
  const raw = readFileSync(resolve(process.cwd(), filePath), 'utf-8')
  const data: SeedFile = JSON.parse(raw)

  console.log(`\n🌱 Seeding: ${data.test.name}`)

  // 1. Insert test
  const { data: test, error: testError } = await supabase
    .from('tests')
    .insert({
      name: data.test.name,
      duration_mins: data.test.duration_mins,
      is_visible: true,
    })
    .select()
    .single()

  if (testError || !test) {
    console.error('❌ Failed to insert test:', testError?.message)
    process.exit(1)
  }
  console.log(`✅ Test created: ${test.id}`)

  // 2. Insert sections + questions
  for (const sec of data.sections) {
    const { data: section, error: secError } = await supabase
      .from('sections')
      .insert({
        test_id: test.id,
        name: sec.name,
        display_order: sec.display_order,
        question_count: sec.questions.length,
      })
      .select()
      .single()

    if (secError || !section) {
      console.error(`❌ Failed to insert section "${sec.name}":`, secError?.message)
      process.exit(1)
    }
    console.log(`  ✅ Section: ${sec.name} (${sec.questions.length} questions)`)

    const questionsToInsert = sec.questions.map((q, idx) => ({
      test_id: test.id,
      section_id: section.id,
      display_order: idx + 1,
      type: q.type,
      text: q.text,
      options: q.options,
      correct_options: q.correct_options,
    }))

    const { error: qError } = await supabase
      .from('questions')
      .insert(questionsToInsert)

    if (qError) {
      console.error(`❌ Failed to insert questions for "${sec.name}":`, qError.message)
      process.exit(1)
    }
  }

  const totalQuestions = data.sections.reduce((sum, s) => sum + s.questions.length, 0)
  console.log(`\n🎉 Done! Test "${data.test.name}" seeded with ${totalQuestions} questions.`)
  console.log(`   Test ID: ${test.id}`)
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: npx ts-node scripts/seed-test.ts <path-to-json>')
  process.exit(1)
}

seedTest(filePath).catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
