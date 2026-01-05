/**
 * Computes cosine similarity between 2 vectors. Returns 0 when either vector has zero magnitude.
 */
export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  // dotProduct accumulates the sum of element-wise multiplication.
  let dotProduct = 0;
  // vectorASquaredMagnitude tracks the squared length of vector A.
  let vectorASquaredMagnitude = 0;
  // vectorBSquaredMagnitude tracks the squared length of vector B.
  let vectorBSquaredMagnitude = 0;

  // overlappingDimensions ensures we only iterate over the shared length.
  const overlappingDimensions = Math.min(vectorA.length, vectorB.length);
  for (
    let dimensionIndex = 0;
    dimensionIndex < overlappingDimensions;
    dimensionIndex++
  ) {
    // valueA/valueB represent the coordinate values in the current dimension.
    const valueA = vectorA[dimensionIndex] ?? 0;
    const valueB = vectorB[dimensionIndex] ?? 0;
    dotProduct += valueA * valueB;
    vectorASquaredMagnitude += valueA * valueA;
    vectorBSquaredMagnitude += valueB * valueB;
  }
  if (vectorASquaredMagnitude === 0 || vectorBSquaredMagnitude === 0) return 0;
  return (
    dotProduct /
    (Math.sqrt(vectorASquaredMagnitude) * Math.sqrt(vectorBSquaredMagnitude))
  );
}
