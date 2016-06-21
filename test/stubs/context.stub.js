module.exports = function () {
  return {
    constructors: {
      Dsl: function () {
        return {
          register: () => {},
          createFilterId: () => 'filterId',
          test: () => {}
        };
      }
    }
  };
};
