// GET /api/tts/elevenlabs/voices → { configured, voices: [{ id, name, description }] }
import { NextResponse } from 'next/server'
import { listVoices } from '@/lib/tts'

export async function GET() {
  return NextResponse.json(await listVoices())
}
