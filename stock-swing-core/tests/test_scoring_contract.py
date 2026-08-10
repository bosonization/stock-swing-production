from swing_core.analyzer import MAX_SCORE, SCORE_POINTS, SCORING_VERSION, score_from_conditions


EXPECTED_POINTS = {
    "c01": 1, "c02": 2, "c03": 1, "c04": 2, "c05": 2, "c06": 2,
    "c07": -2, "c08": 2, "c09": 2, "c10": 2, "c11": 2, "c12": 2,
    "c13": 2, "c14": 0, "c15": 2, "c16": 2, "c17": 3, "c18": 5,
    "c19": 3, "c20": 3, "c21": 5, "c22": 5, "c23": 5, "c24": 4,
    "c25": 4, "c26": 4,
}


def test_scoring_version_and_points_are_frozen():
    assert SCORING_VERSION == "v2_26_conditions_202606"
    assert SCORE_POINTS == EXPECTED_POINTS
    assert MAX_SCORE == 67


def test_positive_max_and_penalty_count_contract():
    positives = {key: points > 0 for key, points in SCORE_POINTS.items()}
    assert score_from_conditions(positives) == (67, 24)
    with_penalty = {**positives, "c07": True, "c14": True}
    assert score_from_conditions(with_penalty) == (65, 24)


def test_known_condition_vector():
    conditions = {key: False for key in SCORE_POINTS}
    conditions.update(c01=True, c02=True, c07=True, c18=True, c24=True)
    assert score_from_conditions(conditions) == (10, 4)
