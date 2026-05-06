function buildClassCounts(boxes = []) {
  return boxes.reduce((accumulator, box) => {
    const className = box.className;
    if (!className) {
      return accumulator;
    }

    accumulator[className] = (accumulator[className] || 0) + 1;
    return accumulator;
  }, {});
}

function scoreExperiment(experiment, classCounts = {}) {
  const stateRules = experiment?.stateRules || {};
  const scoreRules = experiment?.scoreRules || [];

  const parseAlternativeClassNames = (rawKey) => {
    return String(rawKey || "")
      .split(/[|｜]/)
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const stateResults = scoreRules.map((rule) => {
    const requirements = Object.entries(stateRules[rule.state] || {}).map(([classKey, required]) => {
      const alternatives = parseAlternativeClassNames(classKey);
      const actualList = alternatives.map((name) => ({
        className: name,
        actual: classCounts[name] || 0
      }));
      const bestMatched = actualList.reduce((best, current) => (current.actual > best.actual ? current : best), {
        className: alternatives[0] || classKey,
        actual: 0
      }) || { className: classKey, actual: 0 };
      const passed = actualList.some((item) => item.actual >= required);

      return {
        className: classKey,
        alternatives,
        required,
        actual: bestMatched.actual,
        matchedClassName: bestMatched.className,
        passed
      };
    });

    const passed = requirements.every((item) => item.passed);

    return {
      state: rule.state,
      score: rule.score,
      earnedScore: passed ? rule.score : 0,
      passed,
      requirements
    };
  });

  const totalScore = stateResults.reduce((sum, item) => sum + item.earnedScore, 0);

  return {
    totalScore,
    maxScore: scoreRules.reduce((sum, item) => sum + item.score, 0),
    completedStates: stateResults.filter((item) => item.passed).map((item) => item.state),
    currentState: stateResults.find((item) => !item.passed)?.state || "finish",
    stateResults
  };
}

function getCumulativeScoreKey(experimentKey, cameraId) {
  return `${experimentKey || "default"}::${cameraId || "camera"}`;
}

function getCumulativeScoreSnapshot(cumulativeScoreMemory, experimentKey, cameraId, experiment) {
  const key = getCumulativeScoreKey(experimentKey, cameraId);
  if (cumulativeScoreMemory.has(key)) {
    return cumulativeScoreMemory.get(key);
  }
  return scoreExperiment(experiment, {});
}

function applyCumulativeScore(cumulativeScoreMemory, experimentKey, cameraId, experiment, currentScoreResult) {
  const key = getCumulativeScoreKey(experimentKey, cameraId);
  const previous = cumulativeScoreMemory.get(key);
  const previousPassedMap = (previous?.stateResults || []).reduce((acc, state) => {
    acc[state.state] = Boolean(state.passed);
    return acc;
  }, {});
  const currentMap = (currentScoreResult?.stateResults || []).reduce((acc, state) => {
    acc[state.state] = state;
    return acc;
  }, {});
  const scoreRuleMap = (experiment?.scoreRules || []).reduce((acc, rule) => {
    acc[rule.state] = Number(rule.score || 0);
    return acc;
  }, {});

  const stateResults = (experiment?.scoreRules || []).map((rule) => {
    const stateName = rule.state;
    const currentState = currentMap[stateName] || {
      state: stateName,
      score: Number(rule.score || 0),
      earnedScore: 0,
      passed: false,
      requirements: []
    };
    const cumulativePassed = Boolean(previousPassedMap[stateName] || currentState.passed);
    return {
      ...currentState,
      score: Number(rule.score || currentState.score || 0),
      passed: cumulativePassed,
      earnedScore: cumulativePassed ? Number(scoreRuleMap[stateName] || 0) : 0
    };
  });

  const merged = {
    totalScore: stateResults.reduce((sum, state) => sum + Number(state.earnedScore || 0), 0),
    maxScore: (experiment?.scoreRules || []).reduce((sum, rule) => sum + Number(rule.score || 0), 0),
    completedStates: stateResults.filter((state) => state.passed).map((state) => state.state),
    currentState: stateResults.find((state) => !state.passed)?.state || "finish",
    stateResults
  };

  cumulativeScoreMemory.set(key, merged);
  return merged;
}

function normalizeCameraList(baseCameras, cameras = []) {
  return baseCameras.map((camera, index) => ({
    ...camera,
    ...(cameras[index] || {})
  }));
}

function simplifyCameraResult(camera) {
  return {
    id: camera.id,
    name: camera.name,
    slot: camera.slot,
    rtspUrl: camera.rtspUrl || "",
    online: Boolean(camera.online),
    error: camera.error || null,
    resolutionCheck: camera.resolutionCheck || null,
    totalScore: Number(camera.totalScore || 0),
    maxScore: Number(camera.maxScore || 0),
    completedStates: Array.isArray(camera.completedStates) ? camera.completedStates : [],
    currentState: camera.currentState || null,
    stateResults: Array.isArray(camera.stateResults)
      ? camera.stateResults.map((state) => ({
          state: state.state,
          score: Number(state.score || 0),
          earnedScore: Number(state.earnedScore || 0),
          passed: Boolean(state.passed)
        }))
      : []
  };
}

module.exports = {
  buildClassCounts,
  scoreExperiment,
  getCumulativeScoreKey,
  getCumulativeScoreSnapshot,
  applyCumulativeScore,
  normalizeCameraList,
  simplifyCameraResult
};
