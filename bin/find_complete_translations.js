#!/usr/bin/env node

// Cross-platform version of find_complete_translations.sh
// checks if there are any new translations which reached the threshold to be included in the language selection

import fs from 'fs'
import path from 'path'

const threshold = 150

function findCompleteTranslations() {
  const localesDir = '_locales'
  const languagesFile = path.join(localesDir, '_languages.json')

  // Read current language list
  const currentList = Object.keys(
    JSON.parse(fs.readFileSync(languagesFile, 'utf-8'))
  )

  // Get all XML files in _locales directory
  const files = fs
    .readdirSync(localesDir)
    .filter(file => file.endsWith('.xml'))
    .map(file => {
      const filePath = path.join(localesDir, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const lines = content.split('\n').length
      const lang = file.replace('.xml', '')
      return [lines, lang]
    })
    .filter(([lines]) => lines >= threshold)
    .sort(([a], [b]) => a - b)

  // Check for missing languages
  for (const [lines, lang] of files) {
    if (currentList.indexOf(lang) === -1) {
      console.log(
        `${lang} is not in languagelist, despite having enough lines (${lines}), maybe it is new`
      )
    }
  }
}

findCompleteTranslations()
