import React from "react"
import { Box, Text } from "ink"

export const Hint = ({ pairs }: { pairs: [string, string][] }) => (
  <Box gap={2}>
    {pairs.map(([key, desc]) => (
      <Box key={key} gap={1}>
        <Text color="white">{key}</Text>
        <Text dimColor>{desc}</Text>
      </Box>
    ))}
  </Box>
)
